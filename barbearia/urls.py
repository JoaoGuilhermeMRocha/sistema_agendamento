from django.urls import path

from . import api

urlpatterns = [
    path("publico/vitrine", api.vitrine),
    path("publico/horarios", api.horarios),
    path("publico/agendamentos", api.agendar),

    path("painel/entrar", api.entrar),
    path("painel/sair", api.sair),
    path("painel/eu", api.eu),
    path("painel/estado", api.estado),
    path("painel/agendamentos", api.atendimentos),
    path("painel/agendamentos/<int:id>/cancelar", api.cancelar),
    path("painel/agendamentos/<int:id>/recorrente", api.recorrente),
    path("painel/agendamentos/<int:id>/encerrar", api.encerrar),
    path("painel/expedientes/<slug:profissional>", api.expediente),
    path("painel/ausencias", api.ausencias),
    path("painel/ausencias/<int:id>", api.ausencia),
    path("painel/bloqueios", api.bloqueios),
    path("painel/bloqueios/<int:id>", api.bloqueio),
    path("painel/servicos", api.servicos),
    path("painel/servicos/<int:id>", api.servico),
    path("painel/produtos", api.produtos),
    path("painel/produtos/<int:id>", api.produto),
    path("painel/exemplo", api.exemplo),
    path("painel/dados-de-teste", api.dados_de_teste),
]
