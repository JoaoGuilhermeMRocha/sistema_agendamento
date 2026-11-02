"""Regras da agenda: disponibilidade, recorrência, escolha de profissional e conflitos.

Tradução de web/agenda.js. As regras são funções puras sobre um Estado (uma "foto" da
agenda carregada do banco por carregar_estado), para poderem ser testadas sem banco.
Quem decide se um horário está livre é este arquivo; o agenda.js só desenha o painel.

Horas são minutos desde a meia-noite (int) e datas são datetime.date.
Dia da semana segue o front e o modelo Expediente: 0 = domingo.
"""

import calendar
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

INTERVALO_EM_DIAS = {"semanal": 7, "quinzenal": 14}


def parametro(nome):
    return settings.AGENDA[nome]


def minutos(hora):
    """datetime.time -> minutos desde a meia-noite."""
    return hora.hour * 60 + hora.minute


def dia_da_semana(data):
    return (data.weekday() + 1) % 7


def sobrepoe(inicio, fim, outro_inicio, outro_fim):
    return inicio < outro_fim and outro_inicio < fim


@dataclass(frozen=True)
class Expediente:
    inicio: int
    fim: int
    pausa_inicio: int | None = None
    pausa_fim: int | None = None


@dataclass(frozen=True)
class Bloqueio:
    data: date
    motivo: str
    hora_inicio: int | None = None
    hora_fim: int | None = None


@dataclass(frozen=True)
class Ausencia:
    profissional: str
    inicio: date
    fim: date
    hora_inicio: int | None = None
    hora_fim: int | None = None


@dataclass(frozen=True)
class Atendimento:
    id: int
    profissional: str
    data: date
    inicio: int
    duracao: int
    frequencia: str = "nenhuma"
    vezes: int | None = 1
    ate: date | None = None
    excecoes: frozenset = frozenset()


@dataclass
class Estado:
    agora: datetime
    profissionais: list[str]
    # {profissional: {dia_da_semana: Expediente}}. Dia ausente = folga.
    expedientes: dict[str, dict[int, Expediente]] = field(default_factory=dict)
    bloqueios: list[Bloqueio] = field(default_factory=list)
    ausencias: list[Ausencia] = field(default_factory=list)
    atendimentos: list[Atendimento] = field(default_factory=list)
    # Atendimentos de cada dia, calculados uma vez só (a lista de horários pergunta o mesmo dia muitas vezes).
    # Mexeu em `atendimentos` depois de consultar? Limpe com _por_dia.clear().
    _por_dia: dict = field(default_factory=dict, repr=False)

    @property
    def hoje(self):
        return self.agora.date()

    @property
    def minuto_atual(self):
        return self.agora.hour * 60 + self.agora.minute


def carregar_estado(agora=None):
    """Monta o Estado a partir do banco, com o que ainda pode acontecer de hoje em diante."""
    from .models import Agendamento, Ausencia as AusenciaModel, Bloqueio as BloqueioModel, Profissional

    agora = timezone.localtime(agora)
    hoje = agora.date()
    hora = lambda valor: minutos(valor) if valor else None

    estado = Estado(agora=agora, profissionais=list(Profissional.objects.filter(ativo=True).values_list("id", flat=True)))
    for profissional in Profissional.objects.filter(ativo=True).prefetch_related("expedientes"):
        estado.expedientes[profissional.id] = {
            item.dia_semana: Expediente(minutos(item.inicio), minutos(item.fim), hora(item.pausa_inicio), hora(item.pausa_fim))
            for item in profissional.expedientes.all()
        }
    estado.bloqueios = [
        Bloqueio(item.data, item.motivo, hora(item.hora_inicio), hora(item.hora_fim))
        for item in BloqueioModel.objects.filter(data__gte=hoje)
    ]
    estado.ausencias = [
        Ausencia(item.profissional_id, item.inicio, item.fim, hora(item.hora_inicio), hora(item.hora_fim))
        for item in AusenciaModel.objects.filter(fim__gte=hoje)
    ]
    # Avulsos de hoje em diante e séries que ainda não foram encerradas.
    vigentes = Q(data__gte=hoje) | (~Q(frequencia="nenhuma") & (Q(ate__isnull=True) | Q(ate__gt=hoje)))
    estado.atendimentos = [
        Atendimento(
            id=item.id, profissional=item.profissional_id, data=item.data, inicio=minutos(item.inicio),
            duracao=item.duracao, frequencia=item.frequencia, vezes=item.vezes, ate=item.ate,
            excecoes=frozenset(excecao.data for excecao in item.excecoes.all()),
        )
        for item in Agendamento.objects.filter(vigentes).prefetch_related("excecoes")
    ]
    return estado


# Recorrência

def regra_mensal(data):
    """A repetição mensal segue o dia da semana do mês ("toda 3ª terça"), para nunca cair
    num dia fechado nem num dia 31 que não existe. A 5ª ocorrência vira "a última do mês"."""
    ordem = (data.day - 1) // 7 + 1
    return dia_da_semana(data), (-1 if ordem == 5 else ordem)


def data_mensal(base, meses_depois, regra):
    """Data da regra mensal no mês que fica `meses_depois` meses após o mês de `base`."""
    ano, mes = divmod(base.year * 12 + base.month - 1 + meses_depois, 12)
    mes += 1
    dia_semana, ordem = regra
    if ordem == -1:
        ultimo = date(ano, mes, calendar.monthrange(ano, mes)[1])
        return ultimo - timedelta(days=(dia_da_semana(ultimo) - dia_semana) % 7)
    avanco = (dia_semana - dia_da_semana(date(ano, mes, 1))) % 7
    return date(ano, mes, 1 + avanco + (ordem - 1) * 7)


def datas_da_serie(primeira, frequencia, vezes):
    """Datas de uma série a partir da primeira. Sem número de vezes, vai até o horizonte."""
    if frequencia == "nenhuma":
        return [primeira]
    limite = primeira + timedelta(days=parametro("horizonte_recorrencia_dias"))
    regra = regra_mensal(primeira)
    datas = []
    indice = 0
    while vezes is None or indice < vezes:
        if frequencia == "mensal":
            data = data_mensal(primeira, indice, regra)
        else:
            data = primeira + timedelta(days=indice * INTERVALO_EM_DIAS[frequencia])
        if vezes is None and data > limite:
            break
        datas.append(data)
        indice += 1
    return datas


def primeira_ocorrencia_desde(primeira, frequencia, alvo):
    """Primeira data da regra, a partir de `primeira`, que cai em `alvo` ou depois."""
    if frequencia == "mensal":
        regra = regra_mensal(primeira)
        indice = 0
        while (data := data_mensal(primeira, indice, regra)) < alvo:
            indice += 1
        return data
    passo = INTERVALO_EM_DIAS[frequencia]
    passos = -(-max(0, (alvo - primeira).days) // passo)  # divisão arredondando para cima
    return primeira + timedelta(days=passos * passo)


def inicio_da_recorrencia(estado, atendimento, frequencia):
    """Onde começa a série quando um avulso vira recorrente: nele mesmo, se é de hoje ou
    futuro; se já passou, na próxima data da regra (o que passou não é recriado)."""
    if atendimento.data >= estado.hoje:
        return atendimento.data
    data = primeira_ocorrencia_desde(atendimento.data, frequencia, estado.hoje)
    if data == estado.hoje and atendimento.inicio <= estado.minuto_atual:
        return primeira_ocorrencia_desde(atendimento.data, frequencia, estado.hoje + timedelta(days=1))
    return data


def ocorre_em(atendimento, data):
    if data < atendimento.data or (atendimento.ate and data >= atendimento.ate) or data in atendimento.excecoes:
        return False
    if atendimento.frequencia == "nenhuma":
        return data == atendimento.data
    if atendimento.frequencia == "mensal":
        if data_mensal(data, 0, regra_mensal(atendimento.data)) != data:
            return False
        indice = (data.year - atendimento.data.year) * 12 + data.month - atendimento.data.month
    else:
        dias = (data - atendimento.data).days
        passo = INTERVALO_EM_DIAS[atendimento.frequencia]
        if dias % passo:
            return False
        indice = dias // passo
    return atendimento.vezes is None or indice < atendimento.vezes


def atendimentos_do_dia(estado, data):
    if data not in estado._por_dia:
        estado._por_dia[data] = sorted(
            (item for item in estado.atendimentos if ocorre_em(item, data)), key=lambda item: item.inicio)
    return estado._por_dia[data]


# Disponibilidade

def expediente_do_dia(estado, profissional, data):
    return estado.expedientes.get(profissional, {}).get(dia_da_semana(data))


def _intervalo_livre(item, inicio, fim):
    """Bloqueio ou ausência sem horas vale para o dia inteiro: nunca deixa o intervalo livre."""
    return item.hora_inicio is not None and not sobrepoe(inicio, fim, item.hora_inicio, item.hora_fim)


def motivo_indisponivel(estado, profissional, data, inicio, duracao):
    """Por que o profissional não atende nesse intervalo, sem contar outros clientes. None = pode atender."""
    expediente = expediente_do_dia(estado, profissional, data)
    if not expediente:
        return "Dia de folga do profissional"
    fim = inicio + duracao
    if inicio < expediente.inicio or fim > expediente.fim:
        return "Fora do expediente"
    if expediente.pausa_inicio is not None and sobrepoe(inicio, fim, expediente.pausa_inicio, expediente.pausa_fim):
        return "Na pausa do profissional"
    for bloqueio in estado.bloqueios:
        if bloqueio.data == data and not _intervalo_livre(bloqueio, inicio, fim):
            return f"Bloqueio: {bloqueio.motivo}"
    for ausencia in estado.ausencias:
        if (ausencia.profissional == profissional and ausencia.inicio <= data <= ausencia.fim
                and not _intervalo_livre(ausencia, inicio, fim)):
            return "Profissional ausente"
    return None


def conflito_do_atendimento(estado, atendimento, data):
    return motivo_indisponivel(estado, atendimento.profissional, data, atendimento.inicio, atendimento.duracao)


def conflitos_futuros(estado):
    """Atendimentos já marcados, de hoje até o horizonte, que caíram fora do horário de atendimento."""
    conflitos = []
    for dia in range(parametro("horizonte_recorrencia_dias") + 1):
        data = estado.hoje + timedelta(days=dia)
        for atendimento in atendimentos_do_dia(estado, data):
            if motivo := conflito_do_atendimento(estado, atendimento, data):
                conflitos.append((atendimento, data, motivo))
    return conflitos


def profissional_livre(estado, profissional, data, inicio, duracao, ignorar_id=None):
    if motivo_indisponivel(estado, profissional, data, inicio, duracao):
        return False
    if data < estado.hoje or (data == estado.hoje and inicio <= estado.minuto_atual):
        return False
    fim = inicio + duracao
    return not any(
        item.id != ignorar_id and item.profissional == profissional
        and sobrepoe(inicio, fim, item.inicio, item.inicio + item.duracao)
        for item in atendimentos_do_dia(estado, data)
    )


def escolher_profissional(estado, preferido, datas, inicio, duracao):
    """Com profissional definido, só ele serve. Sem preferência, escolhe quem está livre
    em todas as datas e tem menos atendimentos no primeiro dia, para dividir os clientes."""
    if not datas:
        return None
    candidatos = [preferido] if preferido else estado.profissionais
    livres = [
        profissional for profissional in candidatos
        if all(profissional_livre(estado, profissional, data, inicio, duracao) for data in datas)
    ]
    if len(livres) < 2:
        return livres[0] if livres else None
    do_dia = atendimentos_do_dia(estado, datas[0])
    return min(livres, key=lambda profissional: sum(item.profissional == profissional for item in do_dia))


def horarios_livres(estado, data, duracao, profissional=None, frequencia="nenhuma", vezes=1):
    """Horários de início (em minutos) em que dá para marcar, de 15 em 15 minutos."""
    if not duracao:
        return []
    ids = [profissional] if profissional else estado.profissionais
    expedientes = [item for item in (expediente_do_dia(estado, id, data) for id in ids) if item]
    if not expedientes:
        return []
    datas = datas_da_serie(data, frequencia, vezes)
    primeiro = min(item.inicio for item in expedientes)
    ultimo = max(item.fim for item in expedientes)
    return [
        inicio for inicio in range(primeiro, ultimo - duracao + 1, parametro("intervalo_minutos"))
        if escolher_profissional(estado, profissional, datas, inicio, duracao)
    ]


def dia_fechado(estado, data, profissional=None):
    ids = [profissional] if profissional else estado.profissionais
    return (all(not expediente_do_dia(estado, id, data) for id in ids)
            or any(bloqueio.data == data and bloqueio.hora_inicio is None for bloqueio in estado.bloqueios))
