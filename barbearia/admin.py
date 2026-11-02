from django.contrib import admin, messages

from .dados import TELEFONE_REMOVIDO, anonimizar_cliente
from .models import Agendamento, Ausencia, Bloqueio, Excecao, Expediente, Produto, Profissional, Servico

admin.site.site_header = "AR Systems"
admin.site.site_title = "AR Systems"
admin.site.index_title = "Administração"


class ExpedienteInline(admin.TabularInline):
    model = Expediente
    extra = 0


@admin.register(Profissional)
class ProfissionalAdmin(admin.ModelAdmin):
    list_display = ["nome", "id", "descricao", "usuario", "ordem", "ativo"]
    list_editable = ["ordem", "ativo"]
    autocomplete_fields = ["usuario"]
    inlines = [ExpedienteInline]


@admin.register(Servico)
class ServicoAdmin(admin.ModelAdmin):
    list_display = ["nome", "preco", "duracao", "icone", "removido"]
    list_filter = ["removido"]


@admin.register(Produto)
class ProdutoAdmin(admin.ModelAdmin):
    list_display = ["nome", "preco"]


class ExcecaoInline(admin.TabularInline):
    model = Excecao
    extra = 0


@admin.register(Agendamento)
class AgendamentoAdmin(admin.ModelAdmin):
    list_display = ["cliente_nome", "data", "inicio", "profissional", "preco", "frequencia", "origem"]
    list_filter = ["profissional", "frequencia", "origem"]
    search_fields = ["cliente_nome", "cliente_telefone"]
    date_hierarchy = "data"
    filter_horizontal = ["servicos"]
    inlines = [ExcecaoInline]
    actions = ["apagar_dados_do_cliente"]

    @admin.action(description="LGPD: apagar nome e WhatsApp destes clientes (em todos os atendimentos deles)")
    def apagar_dados_do_cliente(self, request, queryset):
        """Para quando o cliente pede para apagar os dados. Ache um atendimento dele pela busca
        (nome ou telefone), marque e rode esta ação. Os futuros são cancelados."""
        telefones = set(queryset.exclude(cliente_telefone=TELEFONE_REMOVIDO).values_list("cliente_telefone", flat=True))
        total = sum(anonimizar_cliente(telefone) for telefone in telefones)
        self.message_user(request, f"{len(telefones)} cliente(s) anonimizado(s), em {total} atendimento(s).", messages.SUCCESS)


@admin.register(Ausencia)
class AusenciaAdmin(admin.ModelAdmin):
    list_display = ["profissional", "inicio", "fim", "hora_inicio", "hora_fim"]
    list_filter = ["profissional"]


@admin.register(Bloqueio)
class BloqueioAdmin(admin.ModelAdmin):
    list_display = ["data", "motivo", "hora_inicio", "hora_fim"]
