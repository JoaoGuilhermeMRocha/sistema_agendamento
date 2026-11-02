from django.contrib import admin

from .models import Agendamento, Ausencia, Bloqueio, Excecao, Expediente, Produto, Profissional, Servico

admin.site.site_header = "AR Systems"
admin.site.site_title = "AR Systems"
admin.site.index_title = "Administração"


class ExpedienteInline(admin.TabularInline):
    model = Expediente
    extra = 0


@admin.register(Profissional)
class ProfissionalAdmin(admin.ModelAdmin):
    list_display = ["nome", "id", "descricao", "ordem", "ativo"]
    list_editable = ["ordem", "ativo"]
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


@admin.register(Ausencia)
class AusenciaAdmin(admin.ModelAdmin):
    list_display = ["profissional", "inicio", "fim", "hora_inicio", "hora_fim"]
    list_filter = ["profissional"]


@admin.register(Bloqueio)
class BloqueioAdmin(admin.ModelAdmin):
    list_display = ["data", "motivo", "hora_inicio", "hora_fim"]
