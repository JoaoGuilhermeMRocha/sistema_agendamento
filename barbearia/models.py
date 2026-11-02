from django.conf import settings
from django.db import models
from django.db.models import Q, F


DIAS_DA_SEMANA = [
    (0, "Domingo"), (1, "Segunda"), (2, "Terça"), (3, "Quarta"),
    (4, "Quinta"), (5, "Sexta"), (6, "Sábado"),
]

# Mesmos nomes dos ícones de web/ui.js (ICONES_DE_SERVICO em web/dados.js).
ICONES_DE_SERVICO = [
    ("tesoura", "Corte"), ("barba", "Barba"), ("sobrancelha", "Sobrancelha"), ("navalha", "Navalha"),
    ("pente", "Penteado"), ("gota", "Tratamento"), ("estrela", "Outro"),
]


class Profissional(models.Model):
    # O id em texto ("santiago") é o mesmo que o front já usa.
    id = models.SlugField(primary_key=True, max_length=30)
    nome = models.CharField(max_length=40)
    descricao = models.CharField("descrição", max_length=80, blank=True)
    foto = models.ImageField(upload_to="profissionais/", blank=True)
    ordem = models.PositiveSmallIntegerField(default=0, help_text="Posição na lista do agendamento.")
    ativo = models.BooleanField(default=True)
    # Login do barbeiro no painel. Ele vê os valores só dos próprios atendimentos.
    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="profissional", verbose_name="usuário do painel",
    )

    class Meta:
        ordering = ["ordem", "nome"]
        verbose_name_plural = "profissionais"

    def __str__(self):
        return self.nome


class Expediente(models.Model):
    """Horário de trabalho de um profissional num dia da semana. Dia sem linha é folga."""
    profissional = models.ForeignKey(Profissional, on_delete=models.CASCADE, related_name="expedientes")
    dia_semana = models.PositiveSmallIntegerField("dia da semana", choices=DIAS_DA_SEMANA)
    inicio = models.TimeField("início")
    fim = models.TimeField()
    pausa_inicio = models.TimeField("início da pausa", null=True, blank=True)
    pausa_fim = models.TimeField("fim da pausa", null=True, blank=True)

    class Meta:
        ordering = ["profissional", "dia_semana"]
        constraints = [
            models.UniqueConstraint(fields=["profissional", "dia_semana"], name="expediente_unico_por_dia"),
            models.CheckConstraint(condition=Q(inicio__lt=F("fim")), name="expediente_inicio_antes_do_fim"),
            # Pausa: as duas horas vazias, ou as duas preenchidas e dentro do expediente.
            models.CheckConstraint(
                condition=Q(pausa_inicio__isnull=True, pausa_fim__isnull=True) | Q(
                    pausa_inicio__gt=F("inicio"), pausa_inicio__lt=F("pausa_fim"), pausa_fim__lt=F("fim")),
                name="expediente_pausa_valida",
            ),
        ]

    def __str__(self):
        return f"{self.profissional} · {self.get_dia_semana_display()}"


class Ausencia(models.Model):
    """Profissional fora num período. Sem horas, vale o dia inteiro."""
    profissional = models.ForeignKey(Profissional, on_delete=models.CASCADE, related_name="ausencias")
    inicio = models.DateField("primeiro dia")
    fim = models.DateField("último dia")
    hora_inicio = models.TimeField(null=True, blank=True)
    hora_fim = models.TimeField(null=True, blank=True)

    class Meta:
        ordering = ["inicio"]
        verbose_name = "ausência"
        constraints = [
            models.CheckConstraint(condition=Q(inicio__lte=F("fim")), name="ausencia_periodo_valido"),
            models.CheckConstraint(
                condition=Q(hora_inicio__isnull=True, hora_fim__isnull=True) | Q(hora_inicio__lt=F("hora_fim")),
                name="ausencia_horas_validas",
            ),
        ]

    def __str__(self):
        return f"{self.profissional} · {self.inicio:%d/%m} a {self.fim:%d/%m}"


class Bloqueio(models.Model):
    """Feriado ou fechamento da barbearia toda. Sem horas, vale o dia inteiro."""
    data = models.DateField()
    motivo = models.CharField(max_length=60)
    hora_inicio = models.TimeField(null=True, blank=True)
    hora_fim = models.TimeField(null=True, blank=True)

    class Meta:
        ordering = ["data"]
        constraints = [
            models.CheckConstraint(
                condition=Q(hora_inicio__isnull=True, hora_fim__isnull=True) | Q(hora_inicio__lt=F("hora_fim")),
                name="bloqueio_horas_validas",
            ),
        ]

    def __str__(self):
        return f"{self.data:%d/%m/%Y} · {self.motivo}"


class Servico(models.Model):
    nome = models.CharField(max_length=60)
    preco = models.DecimalField("preço", max_digits=8, decimal_places=2)
    duracao = models.PositiveSmallIntegerField("duração", help_text="Em minutos, de 15 em 15.")
    icone = models.CharField("símbolo na agenda", max_length=20, choices=ICONES_DE_SERVICO, default="tesoura")
    # Removido some das listas, mas continua no banco para os atendimentos antigos mostrarem o nome.
    removido = models.BooleanField(default=False)

    class Meta:
        ordering = ["id"]
        verbose_name = "serviço"
        constraints = [
            models.CheckConstraint(condition=Q(preco__gte=0), name="servico_preco_positivo"),
            models.CheckConstraint(condition=Q(duracao__gte=15, duracao__lte=480), name="servico_duracao_valida"),
        ]

    def __str__(self):
        return self.nome


class Produto(models.Model):
    nome = models.CharField(max_length=80)
    preco = models.DecimalField("preço", max_digits=8, decimal_places=2)
    descricao = models.CharField("descrição", max_length=200, blank=True)
    foto = models.ImageField(upload_to="produtos/", blank=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(condition=Q(preco__gt=0), name="produto_preco_positivo"),
        ]

    def __str__(self):
        return self.nome


class Agendamento(models.Model):
    """Um atendimento, ou a primeira data de uma série que se repete.

    A série guarda a regra (frequência e vezes), não as datas: quem calcula se ele cai
    num dia são as regras da agenda, descontando as exceções e o encerramento (ate).
    """

    class Frequencia(models.TextChoices):
        NENHUMA = "nenhuma", "Não repete"
        SEMANAL = "semanal", "Toda semana"
        QUINZENAL = "quinzenal", "A cada 15 dias"
        MENSAL = "mensal", "Todo mês"

    class Origem(models.TextChoices):
        CLIENTE = "cliente", "Site"
        PAINEL = "painel", "Painel"

    cliente_nome = models.CharField("cliente", max_length=80)
    cliente_telefone = models.CharField("WhatsApp", max_length=11, help_text="Só dígitos, com DDD.")
    servicos = models.ManyToManyField(Servico, related_name="agendamentos", verbose_name="serviços")
    profissional = models.ForeignKey(Profissional, on_delete=models.PROTECT, related_name="agendamentos")
    data = models.DateField()
    inicio = models.TimeField("início")
    # Preço e duração da época em que foi marcado: mudar o serviço depois não altera quem já marcou.
    duracao = models.PositiveSmallIntegerField("duração")
    preco = models.DecimalField("preço", max_digits=8, decimal_places=2)
    frequencia = models.CharField(max_length=10, choices=Frequencia.choices, default=Frequencia.NENHUMA)
    # Total de atendimentos da série. Vazio numa série = sem data para terminar.
    vezes = models.PositiveSmallIntegerField(null=True, blank=True, default=1)
    # Repetição encerrada: esta data e as seguintes deixam de existir.
    ate = models.DateField("encerrada a partir de", null=True, blank=True)
    origem = models.CharField(max_length=10, choices=Origem.choices, default=Origem.CLIENTE)
    criado_em = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["data", "inicio"]
        indexes = [models.Index(fields=["profissional", "data"])]
        constraints = [
            models.CheckConstraint(condition=Q(cliente_telefone__regex=r"^\d{10,11}$"), name="agendamento_telefone_valido"),
            models.CheckConstraint(
                condition=Q(frequencia="nenhuma", vezes=1) | (
                    ~Q(frequencia="nenhuma") & (Q(vezes__isnull=True) | Q(vezes__gte=2, vezes__lte=52))),
                name="agendamento_repeticao_valida",
            ),
        ]

    def __str__(self):
        return f"{self.cliente_nome} · {self.data:%d/%m/%Y} {self.inicio:%H:%M}"


class Excecao(models.Model):
    """Uma data cancelada dentro de uma série que se repete."""
    agendamento = models.ForeignKey(Agendamento, on_delete=models.CASCADE, related_name="excecoes")
    data = models.DateField()

    class Meta:
        ordering = ["data"]
        verbose_name = "data cancelada"
        verbose_name_plural = "datas canceladas"
        constraints = [
            models.UniqueConstraint(fields=["agendamento", "data"], name="excecao_unica_por_data"),
        ]

    def __str__(self):
        return f"{self.data:%d/%m/%Y}"
