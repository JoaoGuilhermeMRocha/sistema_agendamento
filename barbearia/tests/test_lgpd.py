"""Testes do perfil dos profissionais e das ferramentas da LGPD."""

import tempfile
from datetime import time, timedelta

from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone

from barbearia import dados
from barbearia.models import Agendamento, Profissional
from barbearia.tests.test_api import ApiTestCase, foto_jpeg

HOJE = timezone.localdate()


def marcar(telefone, data, nome="Ana", frequencia="nenhuma", vezes=1, **extras):
    return Agendamento.objects.create(
        cliente_nome=nome, cliente_telefone=telefone, profissional_id="santiago", data=data, inicio=time(10),
        duracao=30, preco=30, frequencia=frequencia, vezes=vezes, **extras)


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix="midia-teste-"))
class PerfilTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.barbeiro("damigo"))

    def test_editar_nome_descricao_e_foto(self):
        status, resposta = self.chamar("put", "/api/painel/profissionais/santiago",
                                       {"nome": "Santiago Souza", "descricao": "Dono e barbeiro", "foto": foto_jpeg()})
        self.assertEqual(status, 200)
        self.assertEqual(resposta["profissional"]["nome"], "Santiago Souza")
        self.assertRegex(resposta["profissional"]["foto"], r"^/midia/profissionais/santiago.*\.jpg$")

        # A vitrine pública já mostra o perfil novo.
        _, vitrine = self.chamar("get", "/api/publico/vitrine")
        self.assertEqual(vitrine["profissionais"][0]["descricao"], "Dono e barbeiro")

        _, resposta = self.chamar("put", "/api/painel/profissionais/santiago", {"nome": "Santiago", "foto": None})
        self.assertEqual((resposta["profissional"]["foto"], resposta["profissional"]["descricao"]), ("", ""))

    def test_validacoes(self):
        _, resposta = self.chamar("put", "/api/painel/profissionais/santiago", {"nome": "S"})
        self.assertEqual(resposta["erro"], "Informe o nome do profissional.")
        _, resposta = self.chamar("put", "/api/painel/profissionais/fulano", {"nome": "Fulano"})
        self.assertEqual(resposta["erro"], "Profissional inválido.")
        self.client.logout()
        self.assertEqual(self.chamar("put", "/api/painel/profissionais/santiago", {"nome": "Oi"})[0], 401)


class ApagarClienteTests(ApiTestCase):
    def test_apaga_o_cliente_em_todos_os_atendimentos_e_cancela_os_futuros(self):
        passado = marcar("43999998888", HOJE - timedelta(days=30))
        futuro = marcar("43999998888", HOJE + timedelta(days=3))
        serie = marcar("43999998888", HOJE - timedelta(days=14), frequencia="semanal", vezes=None)
        outro = marcar("43911112222", HOJE - timedelta(days=30), nome="Bruno")

        self.assertEqual(dados.anonimizar_cliente("(43) 99999-8888"), 2)
        passado.refresh_from_db()
        self.assertEqual((passado.cliente_nome, passado.cliente_telefone), ("Cliente removido", "0000000000"))
        self.assertEqual(float(passado.preco), 30.0)  # o atendimento continua nos relatórios
        self.assertFalse(Agendamento.objects.filter(pk=futuro.pk).exists())
        serie.refresh_from_db()
        self.assertEqual(serie.ate, HOJE)  # a série para hoje: nada de lembrete para ninguém
        outro.refresh_from_db()
        self.assertEqual(outro.cliente_nome, "Bruno")

    def test_acao_do_admin(self):
        marcar("43999998888", HOJE - timedelta(days=30))
        marcar("43999998888", HOJE - timedelta(days=60))
        self.client.force_login(User.objects.create_superuser("joao", password="uma-senha-boa-123"))
        primeiro = Agendamento.objects.first()
        resposta = self.client.post("/admin/barbearia/agendamento/", {
            "action": "apagar_dados_do_cliente", "_selected_action": [primeiro.pk]}, follow=True)
        self.assertContains(resposta, "1 cliente(s) anonimizado(s), em 2 atendimento(s).")
        self.assertEqual(Agendamento.objects.filter(cliente_telefone="0000000000").count(), 2)


class PrazoDeGuardaTests(ApiTestCase):
    def test_apaga_quem_sumiu_ha_mais_de_2_anos(self):
        sumido = marcar("43999998888", HOJE - timedelta(days=800))
        fiel_antigo = marcar("43911112222", HOJE - timedelta(days=800), nome="Bruno")
        fiel_recente = marcar("43911112222", HOJE - timedelta(days=20), nome="Bruno")
        recorrente = marcar("43933334444", HOJE - timedelta(days=1000), nome="Carla", frequencia="semanal", vezes=None)
        serie_acabou = marcar("43955556666", HOJE - timedelta(days=900), nome="Davi", frequencia="semanal", vezes=4)

        call_command("anonimizar_antigos", stdout=open("/dev/null", "w"))

        nomes = {item.pk: item.cliente_nome for item in Agendamento.objects.all()}
        self.assertEqual(nomes[sumido.pk], "Cliente removido")
        self.assertEqual(nomes[serie_acabou.pk], "Cliente removido")
        # O Bruno voltou mês passado: o histórico inteiro dele fica.
        self.assertEqual((nomes[fiel_antigo.pk], nomes[fiel_recente.pk]), ("Bruno", "Bruno"))
        # Série sem fim ainda está acontecendo.
        self.assertEqual(nomes[recorrente.pk], "Carla")

    def test_serie_encerrada_conta_pela_data_de_encerramento(self):
        encerrada = marcar("43999998888", HOJE - timedelta(days=1000), frequencia="semanal", vezes=None,
                           ate=HOJE - timedelta(days=100))
        self.assertEqual(dados.anonimizar_antigos(), 0)
        encerrada.ate = HOJE - timedelta(days=740)
        encerrada.save()
        self.assertEqual(dados.anonimizar_antigos(), 1)


class PaginaDePrivacidadeTests(ApiTestCase):
    def test_pagina_publica(self):
        resposta = self.client.get("/privacidade")
        self.assertEqual(resposta.status_code, 200)
        self.assertContains(resposta, "Política de privacidade")
        self.assertNotIn("X-Robots-Tag", resposta.headers)
        self.assertContains(self.client.get("/agendar"), 'href="/privacidade"')
