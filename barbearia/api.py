"""API JSON que as páginas chamam.

As respostas seguem o formato do web/dados.js: { ok: true, ... } ou { ok: false, erro } (status 400).
Datas em "AAAA-MM-DD", horas em "HH:MM" e os nomes dos campos iguais aos do front (camelCase).

/api/publico/... é aberta: só mostra o que a página do cliente precisa, nunca dado de outros clientes.
/api/painel/...  exige login (menos entrar e sair). Todos os barbeiros podem alterar tudo, mas cada
um vê o valor só dos próprios atendimentos: nos dos colegas, "preco" vem null.
"""

import json
from datetime import timedelta
from functools import wraps

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.core.cache import cache
from django.http import Http404, JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone

from . import agenda, dados
from .dados import Recusado
from .models import Agendamento, Ausencia, Bloqueio, Expediente, Produto, Profissional, Servico

TENTATIVAS_DE_LOGIN = 5
ESPERA_DO_LOGIN = 15 * 60  # segundos


def profissional_do(usuario):
    """O cadastro de barbeiro ligado ao usuário, se houver e estiver ativo."""
    profissional = getattr(usuario, "profissional", None) if usuario.is_authenticated else None
    return profissional if profissional and profissional.ativo else None


def tem_acesso(usuario):
    """Barbeiro ativo ou o administrador do sistema (o João, para dar suporte)."""
    return usuario.is_authenticated and (usuario.is_superuser or profissional_do(usuario) is not None)


def ve_valor(request, profissional_id):
    return request.user.is_superuser or getattr(profissional_do(request.user), "id", None) == profissional_id


def api(aberta=False, **metodos):
    """Monta uma rota que aceita os métodos HTTP informados (GET=funcao, POST=funcao...).

    Cada função recebe o request, o corpo JSON (dict) e os parâmetros da URL, e devolve um dict.
    Recusado vira { ok: false, erro } com status 400. Sem aberta=True, exige login.
    """
    def rota(request, **parametros):
        if request.method == "GET":
            get_token(request)  # entrega o cookie de CSRF, que os POST precisam mandar de volta
        funcao = metodos.get(request.method)
        if not funcao:
            return JsonResponse({"ok": False, "erro": "Método não permitido."}, status=405)
        if not aberta and not request.user.is_authenticated:
            return JsonResponse({"ok": False, "erro": "Entre com seu usuário e senha."}, status=401)
        if not aberta and not tem_acesso(request.user):
            return JsonResponse({"ok": False, "erro": "Este usuário não tem acesso ao painel."}, status=403)
        corpo = {}
        if request.body:
            try:
                corpo = json.loads(request.body)
            except ValueError:
                corpo = None
            if not isinstance(corpo, dict):
                return JsonResponse({"ok": False, "erro": "Pedido inválido."}, status=400)
        try:
            resposta = funcao(request, corpo, **parametros)
        except Recusado as erro:
            return JsonResponse({"ok": False, "erro": str(erro)}, status=400)
        return JsonResponse({"ok": True, **(resposta or {})})
    return rota


def falha_de_csrf(request, reason=""):
    """Pedido sem o código do cookie de CSRF (CSRF_FAILURE_VIEW): responde no formato da API."""
    return JsonResponse({"ok": False, "erro": "Sua sessão expirou. Recarregue a página e tente de novo."}, status=403)


def so_em_teste(funcao):
    """Ferramentas que apagam dados existem só no computador (DJANGO_DEBUG=1)."""
    @wraps(funcao)
    def envolvida(*args, **kwargs):
        if not settings.DEBUG:
            raise Http404
        return funcao(*args, **kwargs)
    return envolvida


# Conversão para o formato do front

def hora_texto(hora):
    return hora.strftime("%H:%M") if hora else ""


def minutos_texto(total):
    return f"{total // 60:02d}:{total % 60:02d}"


def valor(numero):
    return float(numero)


def profissional_json(profissional):
    return {"id": profissional.id, "nome": profissional.nome, "descricao": profissional.descricao,
            "foto": profissional.foto.url if profissional.foto else ""}


def servico_json(servico):
    return {"id": str(servico.id), "nome": servico.nome, "preco": valor(servico.preco),
            "duracao": servico.duracao, "icone": servico.icone, "removido": servico.removido}


def produto_json(produto):
    return {"id": produto.id, "nome": produto.nome, "preco": valor(produto.preco), "descricao": produto.descricao,
            "foto": produto.foto.url if produto.foto else None}


def agendamento_json(agendamento, ver_valor=True):
    return {
        "id": agendamento.id,
        "cliente": {"nome": agendamento.cliente_nome, "telefone": agendamento.cliente_telefone},
        "servicos": [str(servico.id) for servico in agendamento.servicos.all()],
        "profissionalId": agendamento.profissional_id,
        "data": agendamento.data.isoformat(),
        "inicio": hora_texto(agendamento.inicio),
        "duracao": agendamento.duracao,
        "preco": valor(agendamento.preco) if ver_valor else None,
        "repeticao": {"frequencia": agendamento.frequencia, "vezes": agendamento.vezes},
        "excecoes": [excecao.data.isoformat() for excecao in agendamento.excecoes.all()],
        "ate": agendamento.ate.isoformat() if agendamento.ate else None,
        "origem": agendamento.origem,
        "criadoEm": agendamento.criado_em.isoformat(),
    }


def expedientes_json():
    expedientes = {profissional.id: {str(dia): None for dia in range(7)} for profissional in Profissional.objects.all()}
    for item in Expediente.objects.all():
        expedientes[item.profissional_id][str(item.dia_semana)] = {
            "inicio": hora_texto(item.inicio), "fim": hora_texto(item.fim),
            "pausaInicio": hora_texto(item.pausa_inicio), "pausaFim": hora_texto(item.pausa_fim),
        }
    return expedientes


# Público

def _vitrine(request, corpo):
    """Tudo o que o /agendar e a /loja mostram."""
    return {
        "profissionais": [profissional_json(item) for item in Profissional.objects.filter(ativo=True)],
        "servicos": [servico_json(item) for item in Servico.objects.filter(removido=False)],
        "produtos": [produto_json(item) for item in Produto.objects.all()],
    }


def _horarios(request, corpo):
    """Horários livres dos próximos dias, para os serviços e o profissional escolhidos.

    ?servicos=1,2&profissional=santiago. Sem serviço, usa o mais curto, para os dias não
    aparecerem todos como lotados.
    """
    ids = [id for id in request.GET.get("servicos", "").split(",") if id]
    escolhidos = dados.servicos_escolhidos(ids)
    profissional = request.GET.get("profissional") or None
    if profissional and not Profissional.objects.filter(pk=profissional, ativo=True).exists():
        raise Recusado("Profissional inválido.")
    duracao = (sum(servico.duracao for servico in escolhidos)
               or min(Servico.objects.filter(removido=False).values_list("duracao", flat=True), default=0))

    estado = agenda.carregar_estado()
    dias = []
    for indice in range(settings.AGENDA["dias_para_agendar"]):
        data = estado.hoje + timedelta(days=indice)
        dias.append({
            "data": data.isoformat(),
            "fechado": agenda.dia_fechado(estado, data, profissional),
            "horarios": [minutos_texto(inicio) for inicio in agenda.horarios_livres(estado, data, duracao, profissional)],
        })
    return {"dias": dias}


def _agendar(request, corpo):
    agendamento, _ = dados.criar_agendamento(
        nome=corpo.get("nome"), telefone=corpo.get("telefone"), servicos=corpo.get("servicos"),
        profissional_id=corpo.get("profissionalId"), data=corpo.get("data"), inicio=corpo.get("inicio"),
        origem="cliente",
    )
    return {"agendamento": agendamento_json(agendamento)}


vitrine = api(aberta=True, GET=_vitrine)
horarios = api(aberta=True, GET=_horarios)
agendar = api(aberta=True, POST=_agendar)


# Painel: login

def eu_json(usuario):
    profissional = profissional_do(usuario)
    return {
        "usuario": usuario.get_username(),
        "nome": profissional.nome if profissional else (usuario.get_full_name() or usuario.get_username()),
        "profissionalId": profissional.id if profissional else None,
        "administrador": usuario.is_superuser,
    }


def _entrar(request, corpo):
    nome = str(corpo.get("usuario") or "").strip()
    chave = f"login:{nome.lower()}"
    if cache.get(chave, 0) >= TENTATIVAS_DE_LOGIN:
        raise Recusado("Muitas tentativas erradas. Espere 15 minutos e tente de novo.")
    usuario = authenticate(request, username=nome, password=str(corpo.get("senha") or ""))
    if not usuario:
        cache.set(chave, cache.get(chave, 0) + 1, ESPERA_DO_LOGIN)
        raise Recusado("Usuário ou senha incorretos.")
    if not tem_acesso(usuario):
        raise Recusado("Este usuário não tem acesso ao painel.")
    cache.delete(chave)
    login(request, usuario)
    return {"eu": eu_json(usuario)}


def _sair(request, corpo):
    logout(request)


def _eu(request, corpo):
    """Quem está logado. Sem login, responde 401: é a deixa para o painel mostrar a tela de entrar."""
    return {"eu": eu_json(request.user)}


entrar = api(aberta=True, POST=_entrar)
sair = api(aberta=True, POST=_sair)
eu = api(GET=_eu)


# Painel

def _estado(request, corpo):
    """O estado inteiro, no mesmo formato que o dados.js monta hoje no localStorage."""
    agendamentos = Agendamento.objects.prefetch_related("servicos", "excecoes")
    return {
        "hoje": timezone.localdate().isoformat(),
        # Os botões "Gerar dados de exemplo" e "Apagar dados de teste" só aparecem no computador.
        "ferramentasDeTeste": settings.DEBUG,
        "profissionais": [profissional_json(item) for item in Profissional.objects.filter(ativo=True)],
        "eu": eu_json(request.user),
        "agendamentos": [agendamento_json(item, ve_valor(request, item.profissional_id)) for item in agendamentos],
        "ausencias": [
            {"id": item.id, "profissionalId": item.profissional_id, "inicio": item.inicio.isoformat(),
             "fim": item.fim.isoformat(), "horaInicio": hora_texto(item.hora_inicio), "horaFim": hora_texto(item.hora_fim)}
            for item in Ausencia.objects.all()
        ],
        "bloqueios": [
            {"id": item.id, "data": item.data.isoformat(), "motivo": item.motivo,
             "horaInicio": hora_texto(item.hora_inicio), "horaFim": hora_texto(item.hora_fim)}
            for item in Bloqueio.objects.all()
        ],
        "expedientes": expedientes_json(),
        "servicos": [servico_json(item) for item in Servico.objects.all()],
        "produtos": [produto_json(item) for item in Produto.objects.all()],
    }


def _novo_atendimento(request, corpo):
    agendamento, datas = dados.criar_agendamento(
        nome=corpo.get("nome"), telefone=corpo.get("telefone"), servicos=corpo.get("servicos"),
        profissional_id=corpo.get("profissionalId"), data=corpo.get("data"), inicio=corpo.get("inicio"),
        repeticao=corpo.get("repeticao"), origem="painel",
    )
    return {"agendamento": agendamento_json(agendamento, ve_valor(request, agendamento.profissional_id)),
            "datas": [data.isoformat() for data in datas]}


def _cancelar_data(request, corpo, id):
    dados.cancelar_data(id, corpo.get("data"))


def _tornar_recorrente(request, corpo, id):
    agendamento, datas = dados.tornar_recorrente(id, corpo.get("repeticao"))
    return {"agendamento": agendamento_json(agendamento, ve_valor(request, agendamento.profissional_id)),
            "datas": [data.isoformat() for data in datas]}


def _encerrar_repeticao(request, corpo, id):
    dados.encerrar_repeticao(id, corpo.get("data"))


def _salvar_expediente(request, corpo, profissional):
    return {"conflitos": dados.salvar_expediente(profissional, corpo.get("dias"), simular=bool(corpo.get("simular")))}


def _criar_ausencia(request, corpo):
    return {"conflitos": dados.criar_ausencia(
        profissional_id=corpo.get("profissionalId"), inicio=corpo.get("inicio"), fim=corpo.get("fim"),
        hora_inicio=corpo.get("horaInicio"), hora_fim=corpo.get("horaFim"), simular=bool(corpo.get("simular")))}


def _criar_bloqueio(request, corpo):
    return {"conflitos": dados.criar_bloqueio(
        data=corpo.get("data"), motivo=corpo.get("motivo"), hora_inicio=corpo.get("horaInicio"),
        hora_fim=corpo.get("horaFim"), simular=bool(corpo.get("simular")))}


def _remover_ausencia(request, corpo, id):
    dados.remover_ausencia(id)


def _remover_bloqueio(request, corpo, id):
    dados.remover_bloqueio(id)


def _criar_servico(request, corpo):
    return {"servico": servico_json(dados.criar_servico(corpo))}


def _atualizar_servico(request, corpo, id):
    return {"servico": servico_json(dados.atualizar_servico(id, corpo))}


def _remover_servico(request, corpo, id):
    dados.remover_servico(id)


def _criar_produto(request, corpo):
    return {"produto": produto_json(dados.criar_produto(corpo))}


def _atualizar_produto(request, corpo, id):
    return {"produto": produto_json(dados.atualizar_produto(id, corpo))}


def _remover_produto(request, corpo, id):
    dados.remover_produto(id)


@so_em_teste
def _carregar_exemplo(request, corpo):
    return {"total": dados.carregar_exemplo(corpo.get("agendamentos") or [])}


@so_em_teste
def _apagar_dados_de_teste(request, corpo):
    dados.apagar_dados_de_teste()


estado = api(GET=_estado)
atendimentos = api(POST=_novo_atendimento)
cancelar = api(POST=_cancelar_data)
recorrente = api(POST=_tornar_recorrente)
encerrar = api(POST=_encerrar_repeticao)
expediente = api(PUT=_salvar_expediente)
ausencias = api(POST=_criar_ausencia)
ausencia = api(DELETE=_remover_ausencia)
bloqueios = api(POST=_criar_bloqueio)
bloqueio = api(DELETE=_remover_bloqueio)
servicos = api(POST=_criar_servico)
servico = api(PUT=_atualizar_servico, DELETE=_remover_servico)
produtos = api(POST=_criar_produto)
produto = api(PUT=_atualizar_produto, DELETE=_remover_produto)
exemplo = api(POST=_carregar_exemplo)
dados_de_teste = api(DELETE=_apagar_dados_de_teste)
