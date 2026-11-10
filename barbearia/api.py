"""API JSON que as páginas chamam.

As respostas seguem o formato do web/dados.js: { ok: true, ... } ou { ok: false, erro } (status 400).
Datas em "AAAA-MM-DD", horas em "HH:MM" e os nomes dos campos iguais aos do front (camelCase).

/api/publico/... é aberta: só mostra o que a página do cliente precisa, nunca dado de outros clientes.
/api/painel/...  exige login (menos entrar e sair). Todos os barbeiros podem alterar tudo, mas cada
um vê o valor só dos próprios atendimentos: nos dos colegas, "preco" vem null.
"""

import json
import re
import uuid
from datetime import date, datetime, timedelta, timezone as fuso
from functools import wraps

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.core.cache import cache
from django.http import Http404, HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.http import require_safe

from . import agenda, dados
from .dados import Recusado
from .models import Agendamento, Ausencia, Bloqueio, Expediente, Produto, Profissional, Servico

TENTATIVAS_DE_LOGIN = 5
ESPERA_DO_LOGIN = 15 * 60  # segundos
# Contra robô lotando a agenda com horário falso. Uma família marcando junta cabe com folga.
AGENDAMENTOS_POR_IP = 10
JANELA_DE_AGENDAMENTOS = 60 * 60  # segundos


def ip_do_cliente(request):
    """Na VPS, o Caddy põe o IP de quem acessa no X-Forwarded-For (e descarta o que o próprio
    cliente mandar nesse cabeçalho). No computador, vale o REMOTE_ADDR."""
    encaminhado = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return encaminhado.split(",")[-1].strip() or request.META.get("REMOTE_ADDR", "")


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
        # HEAD responde como GET, sem corpo: é o que o UptimeRobot usa para conferir se o site está no ar
        metodo = "GET" if request.method == "HEAD" else request.method
        if metodo == "GET":
            get_token(request)  # entrega o cookie de CSRF, que os POST precisam mandar de volta
        funcao = metodos.get(metodo)
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
            "duracao": servico.duracao, "icone": servico.icone,
            "complementar": servico.complementar, "removido": servico.removido}


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
            "filaInicio": hora_texto(item.fila_inicio), "filaFim": hora_texto(item.fila_fim),
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

    ?servicos=1,2&profissional=santiago&dias=15. Sem serviço, usa o comum mais curto, para os dias
    não aparecerem todos como lotados. dias vai até AGENDA["dias_para_agendar"] (o padrão).
    No período sequencial (fila) do expediente, entra só o primeiro horário livre. Com um profissional
    escolhido, cada dia diz o período sequencial dele ("sequencial"), para a página avisar o cliente.
    """
    ids = [id for id in request.GET.get("servicos", "").split(",") if id]
    escolhidos = dados.servicos_escolhidos(ids)
    profissional = request.GET.get("profissional") or None
    if profissional and not Profissional.objects.filter(pk=profissional, ativo=True).exists():
        raise Recusado("Profissional inválido.")
    maximo = settings.AGENDA["dias_para_agendar"]
    pedidos = request.GET.get("dias", "")
    quantos = min(int(pedidos), maximo) if pedidos.isdigit() and int(pedidos) > 0 else maximo
    comuns = Servico.objects.filter(removido=False, complementar=False).values_list("duracao", flat=True)
    duracao = sum(servico.duracao for servico in escolhidos) or min(comuns, default=0)

    estado = agenda.carregar_estado()
    dias = []
    for indice in range(quantos):
        data = estado.hoje + timedelta(days=indice)
        expediente = agenda.expediente_do_dia(estado, profissional, data) if profissional else None
        dias.append({
            "sequencial": {"inicio": minutos_texto(expediente.fila_inicio), "fim": minutos_texto(expediente.fila_fim)}
            if expediente and expediente.fila_inicio is not None else None,
            "data": data.isoformat(),
            "fechado": agenda.dia_fechado(estado, data, profissional),
            "horarios": [minutos_texto(inicio)
                         for inicio in agenda.horarios_livres(estado, data, duracao, profissional, fila=True)],
        })
    return {"dias": dias}


def _agendar(request, corpo):
    chave = f"agendamentos:{ip_do_cliente(request)}"
    feitos = cache.get(chave, 0)
    if feitos >= AGENDAMENTOS_POR_IP:
        raise Recusado("Muitos agendamentos seguidos deste aparelho. Espere um pouco ou fale com a barbearia pelo WhatsApp.")
    agendamento, _, _ = dados.criar_agendamento(
        nome=corpo.get("nome"), telefone=corpo.get("telefone"), servicos=corpo.get("servicos"),
        profissional_id=corpo.get("profissionalId"), data=corpo.get("data"), inicio=corpo.get("inicio"),
        origem="cliente",
    )
    # Só conta o que deu certo: quem errou o telefone três vezes não fica bloqueado.
    cache.set(chave, feitos + 1, JANELA_DE_AGENDAMENTOS)
    return {"agendamento": agendamento_json(agendamento)}


def _texto_ics(texto, limite):
    """Texto de um campo do .ics: sem caracteres de controle e com \\ ; , e quebras escapados."""
    texto = re.sub(r"[\x00-\x09\x0b-\x1f\x7f]", "", str(texto or ""))[:limite].strip()
    return texto.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _dobrar_linha(linha):
    """O .ics pede linhas de até 75 bytes; as seguintes continuam com um espaço na frente."""
    partes, atual = [], ""
    for letra in linha:
        if len((atual + letra).encode()) > (75 if not partes else 74):
            partes.append(atual)
            atual = ""
        atual += letra
    partes.append(atual)
    return "\r\n ".join(partes)


@require_safe
def arquivo_de_agenda(request):
    """"Adicionar à minha agenda": devolve um .ics com o horário e um lembrete 24 h antes.

    Não lê nada do banco: só monta o arquivo com o que a tela de confirmação manda (os textos do
    config.js e o horário que o cliente acabou de marcar). Um link comum, e não um arquivo gerado no
    navegador, porque é o que o Safari do iPhone abre direto no Calendário.
    """
    parametros = request.GET
    try:
        dia = date.fromisoformat(parametros.get("data", ""))
        hora, minuto = (int(parte) for parte in re.fullmatch(r"(\d{2}):(\d{2})", parametros.get("inicio", "")).groups())
        duracao = int(parametros.get("duracao", ""))
        if not (0 <= hora < 24 and 0 <= minuto < 60 and 5 <= duracao <= 600):
            raise ValueError
    except (AttributeError, ValueError):
        return HttpResponse("Horário inválido.", status=400, content_type="text/plain; charset=utf-8")

    inicio = datetime(dia.year, dia.month, dia.day, hora, minuto, tzinfo=timezone.get_default_timezone())
    utc = lambda momento: momento.astimezone(fuso.utc).strftime("%Y%m%dT%H%M%SZ")
    titulo = _texto_ics(parametros.get("titulo"), 120) or "Horário marcado"
    linhas = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AR Systems//Agendamento//PT-BR", "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH", "BEGIN:VEVENT",
        f"UID:{uuid.uuid4()}@{request.get_host().split(':')[0]}",
        f"DTSTAMP:{utc(timezone.now())}",
        f"DTSTART:{utc(inicio)}",
        f"DTEND:{utc(inicio + timedelta(minutes=duracao))}",
        f"SUMMARY:{titulo}",
        f"LOCATION:{_texto_ics(parametros.get('local'), 200)}",
        f"DESCRIPTION:{_texto_ics(parametros.get('detalhes'), 500)}",
        "BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:Amanhã: {titulo}", "TRIGGER:-PT24H", "END:VALARM",
        "END:VEVENT", "END:VCALENDAR",
    ]
    resposta = HttpResponse("".join(_dobrar_linha(linha) + "\r\n" for linha in linhas),
                            content_type="text/calendar; charset=utf-8")
    resposta["Content-Disposition"] = f'attachment; filename="horario-{dia.isoformat()}.ics"'
    resposta["Cache-Control"] = "no-store"
    return resposta


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


def _serie_json(request, agendamento, datas, puladas):
    """Resposta de quem cria ou muda uma série: as datas e as que foram puladas, com o motivo."""
    return {"agendamento": agendamento_json(agendamento, ve_valor(request, agendamento.profissional_id)),
            "datas": [data.isoformat() for data in datas],
            "puladas": [{"data": data.isoformat(), "motivo": motivo} for data, motivo in puladas]}


def _novo_atendimento(request, corpo):
    resposta = dados.criar_agendamento(
        nome=corpo.get("nome"), telefone=corpo.get("telefone"), servicos=corpo.get("servicos"),
        profissional_id=corpo.get("profissionalId"), data=corpo.get("data"), inicio=corpo.get("inicio"),
        repeticao=corpo.get("repeticao"), origem="painel",
    )
    return _serie_json(request, *resposta)


def _cancelar_data(request, corpo, id):
    dados.cancelar_data(id, corpo.get("data"))


def _tornar_recorrente(request, corpo, id):
    return _serie_json(request, *dados.tornar_recorrente(id, corpo.get("repeticao")))


def _reagendar(request, corpo, id):
    return _serie_json(request, *dados.reagendar(
        id, data=corpo.get("data"), nova_data=corpo.get("novaData"), inicio=corpo.get("inicio"),
        profissional_id=corpo.get("profissionalId"), escopo=corpo.get("escopo", "dia")))


def _salvar_telefone(request, corpo, id):
    agendamento = dados.salvar_telefone(id, corpo.get("telefone"))
    return {"agendamento": agendamento_json(agendamento, ve_valor(request, agendamento.profissional_id))}


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


def _atualizar_profissional(request, corpo, id):
    profissional = dados.atualizar_profissional(id, corpo)
    return {"profissional": profissional_json(profissional)}


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
reagendar = api(POST=_reagendar)
encerrar = api(POST=_encerrar_repeticao)
telefone = api(PUT=_salvar_telefone)
expediente = api(PUT=_salvar_expediente)
ausencias = api(POST=_criar_ausencia)
ausencia = api(DELETE=_remover_ausencia)
bloqueios = api(POST=_criar_bloqueio)
bloqueio = api(DELETE=_remover_bloqueio)
profissional = api(PUT=_atualizar_profissional)
servicos = api(POST=_criar_servico)
servico = api(PUT=_atualizar_servico, DELETE=_remover_servico)
produtos = api(POST=_criar_produto)
produto = api(PUT=_atualizar_produto, DELETE=_remover_produto)
exemplo = api(POST=_carregar_exemplo)
dados_de_teste = api(DELETE=_apagar_dados_de_teste)
