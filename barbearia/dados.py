"""Validação e gravação: o equivalente de web/dados.js no servidor.

Cada função confere tudo o que recebe (o pedido pode vir de qualquer lugar, não só das
nossas páginas) e recusa com uma mensagem para o usuário levantando Recusado.
"""

import base64
import binascii
import re
from datetime import date, time, timedelta
from decimal import Decimal, InvalidOperation
from io import BytesIO

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from PIL import Image, UnidentifiedImageError

from . import agenda
from .models import ICONES_DE_SERVICO, Agendamento, Ausencia, Bloqueio, Excecao, Expediente, Produto, Profissional, Servico

FREQUENCIAS = {"nenhuma", "semanal", "quinzenal", "trissemanal", "mensal"}


class Recusado(Exception):
    """Pedido inválido ou que fere uma regra. A mensagem vai para a tela."""


def ler_data(valor, erro):
    if not isinstance(valor, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", valor):
        raise Recusado(erro)
    try:
        return date.fromisoformat(valor)
    except ValueError:
        raise Recusado(erro) from None


def ler_hora(valor, erro):
    if not isinstance(valor, str) or not re.fullmatch(r"\d{2}:\d{2}", valor):
        raise Recusado(erro)
    try:
        return time.fromisoformat(valor)
    except ValueError:
        raise Recusado(erro) from None


def ler_valor(valor):
    """Número vindo do JSON (30, 30.5 ou "30.5") em Decimal com centavos. None se não for número."""
    if isinstance(valor, bool) or valor is None or str(valor).strip() == "":
        return None
    try:
        numero = Decimal(str(valor).strip())
    except InvalidOperation:
        return None
    return numero.quantize(Decimal("0.01")) if numero.is_finite() else None


def so_digitos(texto):
    return re.sub(r"\D", "", str(texto or ""))


def _horas_opcionais(hora_inicio, hora_fim, erro):
    """As duas horas vazias (dia inteiro) ou as duas preenchidas e em ordem."""
    if not hora_inicio and not hora_fim:
        return None, None
    if not hora_inicio or not hora_fim:
        raise Recusado(erro)
    inicio, fim = ler_hora(hora_inicio, erro), ler_hora(hora_fim, erro)
    if inicio >= fim:
        raise Recusado(erro)
    return inicio, fim


def _travar_profissionais(ids):
    """Trava as linhas dos profissionais até o fim da transação.

    Dois clientes pedindo o mesmo horário ao mesmo tempo: o segundo espera o primeiro
    gravar e, quando confere a agenda, já vê o horário ocupado. A ordem fixa evita que
    dois pedidos fiquem um esperando o outro para sempre (deadlock).
    """
    list(Profissional.objects.select_for_update().filter(id__in=ids).order_by("id"))


def _atendimento(agendamento):
    """Agendamento do banco -> Atendimento das regras."""
    return agenda.Atendimento(
        id=agendamento.id, profissional=agendamento.profissional_id, data=agendamento.data,
        inicio=agenda.minutos(agendamento.inicio), duracao=agendamento.duracao,
        frequencia=agendamento.frequencia, vezes=agendamento.vezes, ate=agendamento.ate,
        excecoes=frozenset(agendamento.excecoes.values_list("data", flat=True)),
    )


def _buscar(modelo, id, erro):
    try:
        return modelo.objects.get(pk=id)
    except (modelo.DoesNotExist, ValueError, TypeError):
        raise Recusado(erro) from None


# Agendamentos

def normalizar_repeticao(repeticao):
    repeticao = repeticao or {}
    frequencia = repeticao.get("frequencia")
    if frequencia not in FREQUENCIAS or frequencia == "nenhuma":
        return "nenhuma", 1
    vezes = repeticao.get("vezes")
    if vezes is None:
        return frequencia, None
    if not isinstance(vezes, int) or isinstance(vezes, bool) or not 2 <= vezes <= settings.AGENDA["max_atendimentos_repetidos"]:
        raise Recusado("Número de atendimentos inválido.")
    return frequencia, vezes


def servicos_escolhidos(ids):
    """Serviços ativos com esses ids, na ordem pedida. Recusa id que não existe ou foi removido."""
    ativos = {str(servico.id): servico for servico in Servico.objects.filter(removido=False)}
    escolhidos = []
    for id in dict.fromkeys(str(id) for id in (ids if isinstance(ids, list) else [])):
        if id not in ativos:
            raise Recusado("Um dos serviços não está mais disponível. Recarregue a página.")
        escolhidos.append(ativos[id])
    return escolhidos


def criar_agendamento(*, nome, telefone, servicos, profissional_id, data, inicio, repeticao=None, origem="cliente"):
    painel = origem == "painel"
    nome = str(nome or "").strip()
    telefone = so_digitos(telefone)
    if len(nome) < 2:
        raise Recusado("Informe o nome do cliente.")
    # No painel o número é opcional (cliente que marcou no balcão ou por telefone fixo).
    if not re.fullmatch(r"\d{10,11}", telefone) and not (painel and not telefone):
        raise Recusado("Informe um WhatsApp com DDD.")

    escolhidos = servicos_escolhidos(servicos)
    if not escolhidos:
        raise Recusado("Escolha pelo menos um serviço.")
    if all(servico.complementar for servico in escolhidos):
        raise Recusado(f"{' e '.join(servico.nome for servico in escolhidos)} só pode ser marcado junto com outro serviço.")
    ativos = list(Profissional.objects.filter(ativo=True).values_list("id", flat=True))
    if profissional_id and profissional_id not in ativos:
        raise Recusado("Profissional inválido.")
    data = ler_data(data, "Escolha o dia e o horário.")
    inicio = ler_hora(inicio, "Escolha o dia e o horário.")

    # Só o painel cria repetição: o que vem do site vira um atendimento único.
    frequencia, vezes = normalizar_repeticao(repeticao if painel else None)
    hoje = timezone.localdate()
    if not painel and (data - hoje).days >= settings.AGENDA["dias_para_agendar"]:
        raise Recusado("Esse dia ainda não está aberto para agendamento.")
    datas = agenda.datas_da_serie(data, frequencia, vezes)
    duracao = sum(servico.duracao for servico in escolhidos)

    with transaction.atomic():
        _travar_profissionais([profissional_id] if profissional_id else ativos)
        estado = agenda.carregar_estado()
        # Pelo site, quem trabalha com horário sequencial só aceita o primeiro horário livre do dia.
        escolhido = agenda.escolher_profissional(
            estado, profissional_id or None, datas, agenda.minutos(inicio), duracao, fila=not painel)
        if not escolhido:
            raise Recusado("Esse horário não está mais livre. Escolha outro.")
        puladas = agenda.datas_indisponiveis(estado, escolhido, datas[1:], agenda.minutos(inicio), duracao)
        agendamento = Agendamento.objects.create(
            cliente_nome=nome[:80], cliente_telefone=telefone, profissional_id=escolhido, data=data, inicio=inicio,
            duracao=duracao, preco=sum(servico.preco for servico in escolhidos),
            frequencia=frequencia, vezes=vezes, origem="painel" if painel else "cliente",
        )
        agendamento.servicos.set(escolhidos)
        _pular(agendamento, puladas)
    return agendamento, datas, puladas


def _pular(agendamento, puladas):
    """Datas da série em que o profissional não pode atender viram exceção (dia cancelado)."""
    Excecao.objects.bulk_create([Excecao(agendamento=agendamento, data=data) for data, _ in puladas])


def cancelar_data(id, data):
    """Cancela uma única data. Num agendamento avulso, isso apaga o registro."""
    agendamento = _buscar(Agendamento, id, "Agendamento não encontrado.")
    data = ler_data(data, "Data inválida.")
    if agendamento.frequencia == "nenhuma":
        agendamento.delete()
    else:
        Excecao.objects.get_or_create(agendamento=agendamento, data=data)


def tornar_recorrente(id, repeticao):
    """Um avulso passa a se repetir com o mesmo cliente, serviços, profissional e horário.
    Se já passou, fica como está e a série nasce num novo agendamento, na próxima data da regra."""
    original = _buscar(Agendamento, id, "Agendamento não encontrado.")
    if original.frequencia != "nenhuma":
        raise Recusado("Este atendimento já se repete.")
    frequencia, vezes = normalizar_repeticao(repeticao)
    if frequencia == "nenhuma":
        raise Recusado("Escolha de quanto em quanto tempo ele se repete.")
    servicos = list(original.servicos.all())
    if any(servico.removido for servico in servicos):
        raise Recusado("Um dos serviços deste atendimento foi removido. Marque um novo horário na agenda.")

    with transaction.atomic():
        _travar_profissionais([original.profissional_id])
        estado = agenda.carregar_estado()
        primeira = agenda.inicio_da_recorrencia(estado, _atendimento(original), frequencia)
        no_proprio = primeira == original.data
        datas = agenda.datas_da_serie(primeira, frequencia, vezes)
        duracao = original.duracao if no_proprio else sum(servico.duracao for servico in servicos)
        inicio = agenda.minutos(original.inicio)
        # As datas em que ele não pode atender são puladas; só recusa se não sobrar nenhuma.
        puladas = agenda.datas_indisponiveis(
            estado, original.profissional_id, datas[1:] if no_proprio else datas, inicio, duracao)
        if not no_proprio and len(puladas) == len(datas):
            raise Recusado(f"{original.profissional.nome} não está livre em nenhuma data dessa repetição.")

        if no_proprio:
            original.frequencia, original.vezes = frequencia, vezes
            original.save(update_fields=["frequencia", "vezes"])
            _pular(original, puladas)
            return original, datas, puladas
        serie = Agendamento.objects.create(
            cliente_nome=original.cliente_nome, cliente_telefone=original.cliente_telefone,
            profissional_id=original.profissional_id, data=primeira, inicio=original.inicio,
            duracao=duracao, preco=sum(servico.preco for servico in servicos),
            frequencia=frequencia, vezes=vezes, origem="painel",
        )
        serie.servicos.set(servicos)
        _pular(serie, puladas)
    return serie, datas, puladas


def _copiar(original, **campos):
    """Novo agendamento com o cliente, os serviços, o preço, a duração e a origem do original."""
    copia = Agendamento.objects.create(
        cliente_nome=original.cliente_nome, cliente_telefone=original.cliente_telefone, duracao=original.duracao,
        preco=original.preco, origem=original.origem, **campos)
    copia.servicos.set(original.servicos.all())
    return copia


def _mover_serie(original, data, nova_data, inicio, profissional_id):
    """Leva a ocorrência de `data` e as seguintes para o novo dia e horário. As anteriores ficam
    como estão (o que passou não muda nos relatórios). Os dias cancelados continuam cancelados,
    na posição equivalente da série nova. Devolve o agendamento novo e as exceções dele."""
    frequencia = original.frequencia
    atual = agenda.indice_da_ocorrencia(original.data, frequencia, data)
    restantes = None if original.vezes is None else original.vezes - atual
    if original.ate:  # repetição encerrada: conta quantas ocorrências faltavam até o fim
        quantas = 0
        while ((restantes is None or quantas < restantes)
               and agenda.data_da_ocorrencia(original.data, frequencia, atual + quantas) < original.ate):
            quantas += 1
        restantes = quantas
    excecoes = sorted({
        agenda.data_da_ocorrencia(
            nova_data, frequencia, agenda.indice_da_ocorrencia(original.data, frequencia, excecao) - atual)
        for excecao in original.excecoes.filter(data__gt=data).values_list("data", flat=True)
        if restantes is None or agenda.indice_da_ocorrencia(original.data, frequencia, excecao) - atual < restantes
    })
    if restantes == 1:  # sobrou só esta: vira atendimento avulso
        frequencia, vezes, excecoes = "nenhuma", 1, []
    else:
        vezes = restantes

    campos = {"data": nova_data, "inicio": inicio, "profissional_id": profissional_id,
              "frequencia": frequencia, "vezes": vezes, "ate": None}
    if atual == 0:
        original.excecoes.all().delete()
        for campo, valor in campos.items():
            setattr(original, campo, valor)
        original.save()
        alvo = original
    else:
        original.ate = data
        original.save(update_fields=["ate"])
        alvo = _copiar(original, **campos)
    Excecao.objects.bulk_create([Excecao(agendamento=alvo, data=excecao) for excecao in excecoes])
    return alvo, excecoes


def reagendar(id, *, data, nova_data, inicio, profissional_id, escopo="dia"):
    """Muda dia, horário e profissional de um atendimento. Numa série, escopo "dia" muda só a
    ocorrência de `data` (ela vira um atendimento avulso) e "serie" muda essa e as seguintes."""
    original = _buscar(Agendamento, id, "Agendamento não encontrado.")
    data = ler_data(data, "Data inválida.")
    nova_data = ler_data(nova_data, "Escolha o novo dia e horário.")
    inicio = ler_hora(inicio, "Escolha o novo dia e horário.")
    profissional = Profissional.objects.filter(id=profissional_id or "", ativo=True).first()
    if not profissional:
        raise Recusado("Profissional inválido.")
    if escopo not in ("dia", "serie"):
        raise Recusado("Escolha se muda só este dia ou a série.")
    if not agenda.ocorre_em(_atendimento(original), data):
        raise Recusado("Este atendimento não acontece nesse dia. Recarregue a página.")
    minuto = agenda.minutos(inicio)

    with transaction.atomic():
        _travar_profissionais(sorted({original.profissional_id, profissional.id}))
        excecoes = []
        if original.frequencia == "nenhuma":
            original.data, original.inicio, original.profissional = nova_data, inicio, profissional
            original.save(update_fields=["data", "inicio", "profissional"])
            alvo = original
        elif escopo == "dia":
            Excecao.objects.get_or_create(agendamento=original, data=data)
            alvo = _copiar(original, data=nova_data, inicio=inicio, profissional=profissional,
                           frequencia="nenhuma", vezes=1)
        else:
            alvo, excecoes = _mover_serie(original, data, nova_data, inicio, profissional.id)

        # Confere com a mudança já aplicada; se não der, a transação desfaz tudo.
        estado = agenda.carregar_estado()
        if not agenda.profissional_livre(estado, profissional.id, nova_data, minuto, alvo.duracao, ignorar_id=alvo.id):
            motivo = agenda.motivo_indisponivel(estado, profissional.id, nova_data, minuto, alvo.duracao)
            raise Recusado(f"{profissional.nome} não está livre em {nova_data:%d/%m} às {inicio:%H:%M}"
                           f"{f' ({motivo.lower()})' if motivo else ''}. Escolha outro horário.")
        datas = agenda.datas_da_serie(nova_data, alvo.frequencia, alvo.vezes)
        puladas = agenda.datas_indisponiveis(
            estado, profissional.id, [item for item in datas[1:] if item not in excecoes], minuto, alvo.duracao,
            ignorar_id=alvo.id)
        _pular(alvo, puladas)
    return alvo, datas, puladas


def salvar_telefone(id, telefone):
    """Põe (ou troca) o WhatsApp de um atendimento, em todas as datas da série."""
    agendamento = _buscar(Agendamento, id, "Agendamento não encontrado.")
    telefone = so_digitos(telefone)
    if not re.fullmatch(r"\d{10,11}", telefone) or telefone == TELEFONE_REMOVIDO:
        raise Recusado("Informe um WhatsApp com DDD.")
    agendamento.cliente_telefone = telefone
    agendamento.save(update_fields=["cliente_telefone"])
    return agendamento


def encerrar_repeticao(id, data):
    """A data informada e as seguintes deixam de existir."""
    agendamento = _buscar(Agendamento, id, "Agendamento não encontrado.")
    data = ler_data(data, "Data inválida.")
    if data <= agendamento.data:
        agendamento.delete()
    else:
        agendamento.ate = data
        agendamento.save(update_fields=["ate"])


# Expediente, ausências e bloqueios

def _com_simulacao(mudanca, simular):
    """Aplica a mudança e devolve os atendimentos que ela deixou em conflito (os que já
    estavam em conflito antes não contam). Com simular, desfaz tudo no final."""
    with transaction.atomic():
        antes = {(item.id, data) for item, data, _ in agenda.conflitos_futuros(agenda.carregar_estado())}
        mudanca()
        novos = [(item, data, motivo) for item, data, motivo in agenda.conflitos_futuros(agenda.carregar_estado())
                 if (item.id, data) not in antes]
        clientes = Agendamento.objects.in_bulk({item.id for item, _, _ in novos})
        conflitos = [
            {"id": item.id, "cliente": clientes[item.id].cliente_nome, "profissionalId": item.profissional,
             "data": data.isoformat(),
             "inicio": f"{item.inicio // 60:02d}:{item.inicio % 60:02d}", "motivo": motivo}
            for item, data, motivo in novos
        ]
        if simular:
            transaction.set_rollback(True)
    return conflitos


def salvar_expediente(profissional_id, dias, simular=False):
    profissional = _buscar(Profissional, profissional_id, "Profissional inválido.")
    if not isinstance(dias, (dict, list)):
        raise Recusado("Confira o início e o fim de cada dia de trabalho.")
    novos = []
    for dia in range(7):
        item = dias.get(str(dia)) if isinstance(dias, dict) else (dias[dia] if dia < len(dias) else None)
        if not item:
            continue
        erro = "Confira o início e o fim de cada dia de trabalho."
        inicio, fim = ler_hora(item.get("inicio"), erro), ler_hora(item.get("fim"), erro)
        if inicio >= fim:
            raise Recusado(erro)
        pausa_inicio, pausa_fim = _horas_opcionais(
            item.get("pausaInicio"), item.get("pausaFim"), "A pausa precisa ter início e fim dentro do expediente.")
        if pausa_inicio and not (inicio < pausa_inicio and pausa_fim < fim):
            raise Recusado("A pausa precisa ter início e fim dentro do expediente.")
        erro_fila = "O horário sequencial precisa ter início e fim dentro do expediente."
        fila_inicio, fila_fim = _horas_opcionais(item.get("filaInicio"), item.get("filaFim"), erro_fila)
        if fila_inicio and not (inicio <= fila_inicio and fila_fim <= fim):
            raise Recusado(erro_fila)
        novos.append(Expediente(profissional=profissional, dia_semana=dia, inicio=inicio, fim=fim,
                                pausa_inicio=pausa_inicio, pausa_fim=pausa_fim,
                                fila_inicio=fila_inicio, fila_fim=fila_fim))

    def mudanca():
        profissional.expedientes.all().delete()
        Expediente.objects.bulk_create(novos)
    return _com_simulacao(mudanca, simular)


def criar_ausencia(*, profissional_id, inicio, fim, hora_inicio="", hora_fim="", simular=False):
    if not Profissional.objects.filter(pk=profissional_id).exists():
        raise Recusado("Escolha o profissional.")
    erro = "Confira o primeiro e o último dia."
    inicio, fim = ler_data(inicio, erro), ler_data(fim, erro)
    if fim < inicio:
        raise Recusado(erro)
    horas = _horas_opcionais(hora_inicio, hora_fim, "Para ausência parcial, informe as duas horas em ordem.")
    return _com_simulacao(lambda: Ausencia.objects.create(
        profissional_id=profissional_id, inicio=inicio, fim=fim, hora_inicio=horas[0], hora_fim=horas[1]), simular)


def criar_bloqueio(*, data, motivo, hora_inicio="", hora_fim="", simular=False):
    data = ler_data(data, "Escolha a data.")
    motivo = str(motivo or "").strip()
    if not motivo:
        raise Recusado("Informe o motivo.")
    horas = _horas_opcionais(hora_inicio, hora_fim, "Para bloqueio parcial, informe as duas horas em ordem.")
    return _com_simulacao(lambda: Bloqueio.objects.create(
        data=data, motivo=motivo[:60], hora_inicio=horas[0], hora_fim=horas[1]), simular)


def remover_ausencia(id):
    Ausencia.objects.filter(pk=id).delete()


def remover_bloqueio(id):
    Bloqueio.objects.filter(pk=id).delete()


# Serviços

def _campos_do_servico(id, dados):
    nome = str(dados.get("nome") or "").strip()
    preco = ler_valor(dados.get("preco"))
    duracao = dados.get("duracao")
    passo = settings.AGENDA["passo_duracao_minutos"]
    maxima = settings.AGENDA["duracao_maxima_minutos"]
    if not nome:
        raise Recusado("Informe o nome do serviço.")
    if Servico.objects.filter(removido=False, nome__iexact=nome).exclude(pk=id).exists():
        raise Recusado("Já existe um serviço com esse nome.")
    if preco is None or preco < 0:
        raise Recusado("Informe o preço do serviço.")
    if not isinstance(duracao, int) or isinstance(duracao, bool) or not passo <= duracao <= maxima or duracao % passo:
        raise Recusado("Escolha a duração do serviço.")
    icone = dados.get("icone")
    complementar = dados.get("complementar") is True
    if complementar and not Servico.objects.filter(removido=False, complementar=False).exclude(pk=id).exists():
        raise Recusado("Mantenha pelo menos um serviço que não seja complementar.")
    return {"nome": nome[:60], "preco": preco, "duracao": duracao,
            "icone": icone if icone in dict(ICONES_DE_SERVICO) else "tesoura", "complementar": complementar}


def criar_servico(dados):
    return Servico.objects.create(**_campos_do_servico(None, dados))


def atualizar_servico(id, dados):
    """Vale para os próximos agendamentos: os já marcados guardam o preço e a duração da época."""
    servico = Servico.objects.filter(pk=id, removido=False).first() if str(id).isdigit() else None
    if not servico:
        raise Recusado("Esse serviço não existe mais.")
    for campo, valor in _campos_do_servico(servico.pk, dados).items():
        setattr(servico, campo, valor)
    servico.save()
    return servico


def remover_servico(id):
    """Só marca como removido, para os atendimentos antigos continuarem mostrando o nome."""
    with transaction.atomic():
        ativos = list(Servico.objects.select_for_update().filter(removido=False))
        servico = next((item for item in ativos if str(item.pk) == str(id)), None)
        if not servico:
            raise Recusado("Esse serviço não existe mais.")
        if len(ativos) == 1:
            raise Recusado("Mantenha pelo menos um serviço para os clientes escolherem.")
        if not servico.complementar and not any(not item.complementar for item in ativos if item != servico):
            raise Recusado("Mantenha pelo menos um serviço que não seja complementar.")
        servico.removido = True
        servico.save(update_fields=["removido"])


# Produtos

FOTO_MAXIMA = 3 * 1024 * 1024  # bytes; o painel já reduz a foto para 900px antes de mandar


def ler_foto(endereco, nome="produto"):
    """Foto em data URL (data:image/jpeg;base64,...) -> arquivo pronto para o ImageField.

    Abre com o Pillow para garantir que é mesmo uma imagem, e não outra coisa com a extensão trocada.
    """
    achado = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)", str(endereco or ""))
    if not achado:
        raise Recusado("Use uma foto JPG, PNG ou WebP.")
    try:
        bruto = base64.b64decode(achado[2], validate=True)
    except binascii.Error:
        raise Recusado("Não deu para ler essa foto.") from None
    if len(bruto) > FOTO_MAXIMA:
        raise Recusado("A foto é grande demais. Tente outra.")
    try:
        Image.open(BytesIO(bruto)).verify()
    except (UnidentifiedImageError, OSError, SyntaxError):
        raise Recusado("Não deu para ler essa foto.") from None
    return ContentFile(bruto, name=f"{nome}.{'jpg' if achado[1] == 'jpeg' else achado[1]}")

def _campos_do_produto(dados):
    nome = str(dados.get("nome") or "").strip()
    preco = ler_valor(dados.get("preco"))
    if not nome:
        raise Recusado("Informe o nome do produto.")
    if preco is None or preco <= 0:
        raise Recusado("Informe um preço maior que zero.")
    return {"nome": nome[:80], "preco": preco, "descricao": str(dados.get("descricao") or "").strip()[:200]}


def criar_produto(dados):
    produto = Produto(**_campos_do_produto(dados))
    if dados.get("foto"):
        produto.foto = ler_foto(dados["foto"])
    produto.save()
    return produto


def _trocar_foto(objeto, foto, nome):
    """foto: data URL troca, vazio/None tira. Apaga o arquivo antigo do disco."""
    nova = ler_foto(foto, nome) if foto else None
    if objeto.foto:
        objeto.foto.delete(save=False)
    objeto.foto = nova


def atualizar_produto(id, dados):
    """foto: ausente mantém a atual, null remove, data URL troca."""
    produto = _buscar(Produto, id, "Esse produto não existe mais.")
    for campo, valor in _campos_do_produto(dados).items():
        setattr(produto, campo, valor)
    if "foto" in dados:
        _trocar_foto(produto, dados["foto"], "produto")
    produto.save()
    return produto


def remover_produto(id):
    produto = Produto.objects.filter(pk=id).first() if str(id).isdigit() else None
    if produto:
        if produto.foto:
            produto.foto.delete(save=False)
        produto.delete()


# Profissionais (incluir e tirar barbeiro, e criar o login, fica no admin)

def atualizar_profissional(id, dados):
    """Nome, descrição e foto que aparecem no /agendar. foto: ausente mantém, null tira, data URL troca."""
    profissional = _buscar(Profissional, id, "Profissional inválido.")
    nome = str(dados.get("nome") or "").strip()
    if len(nome) < 2:
        raise Recusado("Informe o nome do profissional.")
    profissional.nome = nome[:40]
    profissional.descricao = str(dados.get("descricao") or "").strip()[:80]
    if "foto" in dados:
        _trocar_foto(profissional, dados["foto"], profissional.id)
    profissional.save()
    return profissional


# LGPD

CLIENTE_REMOVIDO = "Cliente removido"
TELEFONE_REMOVIDO = "0000000000"


def chave_do_cliente(telefone, nome):
    """Quem é o cliente: o WhatsApp ou, para quem foi marcado sem número, o nome."""
    return telefone or f"nome:{' '.join(nome.split()).casefold()}"


def _do_cliente(chave):
    if chave.startswith("nome:"):
        return Agendamento.objects.filter(pk__in=[
            item.pk for item in Agendamento.objects.filter(cliente_telefone="")
            if chave_do_cliente("", item.cliente_nome) == chave])
    return Agendamento.objects.filter(cliente_telefone=chave)


def anonimizar_cliente(telefone, nome=""):
    """Direito de apagar (LGPD, art. 18): tira o nome e o WhatsApp do cliente de todos os atendimentos.
    Sem telefone, o cliente é achado pelo nome entre os atendimentos sem número.

    Os atendimentos que já aconteceram continuam nos relatórios, sem identificação. Os que ainda
    vão acontecer são cancelados, porque não dá mais para avisar ninguém.
    """
    telefone = so_digitos(telefone)
    if telefone == TELEFONE_REMOVIDO or not (re.fullmatch(r"\d{10,11}", telefone) or (not telefone and nome.strip())):
        raise Recusado("Informe o WhatsApp do cliente, com DDD.")
    hoje = timezone.localdate()
    with transaction.atomic():
        do_cliente = _do_cliente(chave_do_cliente(telefone, nome))
        do_cliente.filter(frequencia="nenhuma", data__gte=hoje).delete()
        do_cliente.exclude(frequencia="nenhuma").filter(data__gte=hoje).delete()
        do_cliente.exclude(frequencia="nenhuma").filter(Q(ate__isnull=True) | Q(ate__gt=hoje)).update(ate=hoje)
        return do_cliente.update(cliente_nome=CLIENTE_REMOVIDO, cliente_telefone=TELEFONE_REMOVIDO)


def _ultima_data(agendamento):
    """Último dia em que o atendimento acontece (ou None, se a série não tem fim)."""
    if agendamento.frequencia == "nenhuma":
        return agendamento.data
    fim_da_serie = (agenda.datas_da_serie(agendamento.data, agendamento.frequencia, agendamento.vezes)[-1]
                    if agendamento.vezes else None)
    limites = [data for data in (fim_da_serie, agendamento.ate) if data]
    return min(limites) if limites else None


def anonimizar_antigos(dias=None):
    """Prazo de guarda (LGPD): tira nome e WhatsApp de quem não tem atendimento há mais de `dias`.

    Conta pelo cliente (telefone, ou o nome de quem não tem número), não pelo atendimento: o
    cliente fiel que voltou mês passado continua com o histórico inteiro.
    """
    dias = settings.LGPD_GUARDA_DIAS if dias is None else dias
    limite = timezone.localdate() - timedelta(days=dias)
    ultima_por_cliente, ids_por_cliente = {}, {}
    for agendamento in Agendamento.objects.exclude(cliente_telefone=TELEFONE_REMOVIDO):
        chave = chave_do_cliente(agendamento.cliente_telefone, agendamento.cliente_nome)
        ultima = _ultima_data(agendamento)
        anterior = ultima_por_cliente.get(chave, date.min)
        ultima_por_cliente[chave] = date.max if ultima is None else max(anterior, ultima)
        ids_por_cliente.setdefault(chave, []).append(agendamento.pk)
    antigos = [pk for chave, ultima in ultima_por_cliente.items() if ultima < limite for pk in ids_por_cliente[chave]]
    return Agendamento.objects.filter(pk__in=antigos).update(
        cliente_nome=CLIENTE_REMOVIDO, cliente_telefone=TELEFONE_REMOVIDO)


# Ferramentas de teste (só com DJANGO_DEBUG=1)

@transaction.atomic
def carregar_exemplo(agendamentos):
    """Troca todos os atendimentos pelos de exemplo (web/exemplo.js). Grava direto, sem as
    travas de horário no passado, porque o exemplo inclui meses que já passaram."""
    Agendamento.objects.all().delete()
    servicos = {str(servico.id): servico for servico in Servico.objects.all()}
    for item in agendamentos:
        repeticao = item.get("repeticao") or {}
        agendamento = Agendamento.objects.create(
            cliente_nome=item["cliente"]["nome"], cliente_telefone=item["cliente"]["telefone"],
            profissional_id=item["profissionalId"], data=date.fromisoformat(item["data"]),
            inicio=time.fromisoformat(item["inicio"]), duracao=item["duracao"], preco=ler_valor(item["preco"]),
            frequencia=repeticao.get("frequencia", "nenhuma"), vezes=repeticao.get("vezes", 1),
            ate=date.fromisoformat(item["ate"]) if item.get("ate") else None,
            origem=item.get("origem", "cliente"),
        )
        agendamento.servicos.set([servicos[str(id)] for id in item["servicos"] if str(id) in servicos])
        Excecao.objects.bulk_create(
            [Excecao(agendamento=agendamento, data=date.fromisoformat(data)) for data in item.get("excecoes", [])])
    return len(agendamentos)


@transaction.atomic
def apagar_dados_de_teste():
    """Apaga atendimentos, ausências e bloqueios. Serviços, produtos e expedientes ficam."""
    Agendamento.objects.all().delete()
    Ausencia.objects.all().delete()
    Bloqueio.objects.all().delete()
