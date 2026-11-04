"""Testes da API (barbearia/api.py e barbearia/dados.py), com os dados iniciais do Santiago.

Aqui o "agora" é o real, então as datas são calculadas a partir de hoje.
"""

import base64
import json
import os
import tempfile
import threading
from io import BytesIO
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from django.db import connection
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from PIL import Image

from barbearia import dados
from barbearia.models import Agendamento, Excecao, Profissional, Servico

DADOS_INICIAIS = str(settings.BASE_DIR / "clientes" / "santiago" / "dados_iniciais.json")
CABELO, BARBA, SOBRANCELHA = "1", "2", "3"


def proxima(dia_semana):
    """Próxima data (a partir de amanhã) que cai nesse dia da semana (0 = domingo)."""
    data = timezone.localdate() + timedelta(days=1)
    while (data.weekday() + 1) % 7 != dia_semana:
        data += timedelta(days=1)
    return data


class ApiTestCase(TestCase):
    fixtures = [DADOS_INICIAIS]

    def setUp(self):
        cache.clear()  # zera as tentativas de login entre um teste e outro

    def barbeiro(self, profissional, senha="uma-senha-boa-123"):
        usuario = User.objects.create_user(profissional, password=senha)
        Profissional.objects.filter(pk=profissional).update(usuario=usuario)
        return usuario

    def chamar(self, metodo, url, corpo=None):
        resposta = getattr(self.client, metodo)(url, json.dumps(corpo) if corpo is not None else "",
                                                content_type="application/json")
        return resposta.status_code, resposta.json()

    def agendar(self, **campos):
        corpo = {"nome": "Ana Souza", "telefone": "(43) 99999-8888", "servicos": [CABELO],
                 "profissionalId": None, "data": proxima(2).isoformat(), "inicio": "10:00", **campos}
        return self.chamar("post", "/api/publico/agendamentos", corpo)


class PublicoTests(ApiTestCase):
    def test_vitrine_mostra_profissionais_servicos_e_produtos(self):
        status, resposta = self.chamar("get", "/api/publico/vitrine")
        self.assertEqual(status, 200)
        self.assertEqual([item["id"] for item in resposta["profissionais"]], ["santiago", "damigo"])
        self.assertEqual([item["nome"] for item in resposta["servicos"]], ["Cabelo", "Barba", "Sobrancelha"])
        self.assertEqual(len(resposta["produtos"]), 2)
        self.assertIn("csrftoken", self.client.cookies)

    def test_vitrine_aceita_head_do_monitoramento(self):
        # o UptimeRobot confere com HEAD; 405 aqui fazia o site parecer fora do ar
        self.assertEqual(self.client.head("/api/publico/vitrine").status_code, 200)
        self.assertEqual(self.client.head("/api/painel/estado").status_code, 401)

    def test_horarios_dos_proximos_14_dias(self):
        status, resposta = self.chamar("get", f"/api/publico/horarios?servicos={CABELO},{BARBA}")
        self.assertEqual(status, 200)
        dias = {dia["data"]: dia for dia in resposta["dias"]}
        self.assertEqual(len(dias), 14)

        terca = dias[proxima(2).isoformat()]
        self.assertFalse(terca["fechado"])
        self.assertEqual(terca["horarios"][0], "09:00")
        self.assertEqual(terca["horarios"][-1], "17:00")  # cabelo + barba = 1h, termina às 18h
        self.assertNotIn("11:30", terca["horarios"])      # bateria na pausa

        domingo = dias[proxima(0).isoformat()]
        self.assertTrue(domingo["fechado"])
        self.assertEqual(domingo["horarios"], [])

    def test_horarios_nao_mostram_nome_de_cliente(self):
        self.agendar()
        _, resposta = self.chamar("get", "/api/publico/horarios")
        self.assertNotIn("Ana", json.dumps(resposta))

    def test_agendar_grava_com_preco_duracao_e_telefone_so_com_digitos(self):
        status, resposta = self.agendar(servicos=[CABELO, BARBA], profissionalId="damigo")
        self.assertEqual(status, 200)
        agendamento = resposta["agendamento"]
        self.assertEqual((agendamento["preco"], agendamento["duracao"]), (55.0, 60))
        self.assertEqual(agendamento["cliente"]["telefone"], "43999998888")
        self.assertEqual(agendamento["profissionalId"], "damigo")
        self.assertEqual(agendamento["origem"], "cliente")

    def test_mesmo_horario_vai_para_o_outro_barbeiro_e_depois_lota(self):
        _, primeiro = self.agendar()
        _, segundo = self.agendar(nome="Bruno")
        self.assertNotEqual(primeiro["agendamento"]["profissionalId"], segundo["agendamento"]["profissionalId"])

        status, terceiro = self.agendar(nome="Carla")
        self.assertEqual(status, 400)
        self.assertEqual(terceiro, {"ok": False, "erro": "Esse horário não está mais livre. Escolha outro."})

    def test_cliente_nao_cria_repeticao(self):
        _, resposta = self.agendar(repeticao={"frequencia": "semanal", "vezes": 4})
        self.assertEqual(resposta["agendamento"]["repeticao"], {"frequencia": "nenhuma", "vezes": 1})

    def test_validacoes(self):
        casos = [
            ({"nome": "A"}, "Informe o nome do cliente."),
            ({"telefone": "9999"}, "Informe um WhatsApp com DDD."),
            ({"servicos": []}, "Escolha pelo menos um serviço."),
            ({"servicos": ["999"]}, "Um dos serviços não está mais disponível. Recarregue a página."),
            ({"profissionalId": "fulano"}, "Profissional inválido."),
            ({"data": "2026-02-30"}, "Escolha o dia e o horário."),
            ({"inicio": "25:00"}, "Escolha o dia e o horário."),
            ({"data": (timezone.localdate() + timedelta(days=30)).isoformat()},
             "Esse dia ainda não está aberto para agendamento."),
            ({"data": proxima(0).isoformat()}, "Esse horário não está mais livre. Escolha outro."),  # domingo
            ({"data": (timezone.localdate() - timedelta(days=1)).isoformat()},
             "Esse horário não está mais livre. Escolha outro."),
        ]
        for campos, erro in casos:
            with self.subTest(campos=campos):
                status, resposta = self.agendar(**campos)
                self.assertEqual((status, resposta["erro"]), (400, erro))
        self.assertEqual(Agendamento.objects.count(), 0)

    def test_limite_de_agendamentos_por_ip(self):
        terca = proxima(2)
        for indice in range(10):
            hora = f"{9 + indice // 2:02d}:{30 * (indice % 2):02d}"
            if hora >= "12:00":
                hora = f"{int(hora[:2]) + 1:02d}:{hora[3:]}"  # pula a pausa do almoço
            status, resposta = self.agendar(nome=f"Cliente {indice}", inicio=hora, data=terca.isoformat())
            self.assertEqual(status, 200, resposta)
        _, resposta = self.agendar(inicio="16:00", data=terca.isoformat())
        self.assertEqual(resposta["erro"], "Muitos agendamentos seguidos deste aparelho. "
                                           "Espere um pouco ou fale com a barbearia pelo WhatsApp.")
        # Outro IP (o Caddy informa no X-Forwarded-For) continua marcando.
        resposta = self.client.post("/api/publico/agendamentos", json.dumps({
            "nome": "Outra pessoa", "telefone": "43988887777", "servicos": [CABELO],
            "data": terca.isoformat(), "inicio": "16:00"}), content_type="application/json",
            HTTP_X_FORWARDED_FOR="200.200.200.200")
        self.assertEqual(resposta.status_code, 200)

    def test_pedido_que_nao_e_json(self):
        resposta = self.client.post("/api/publico/agendamentos", "isso não é json", content_type="application/json")
        self.assertEqual(resposta.status_code, 400)
        self.assertEqual(self.client.get("/api/publico/agendamentos").status_code, 405)


class PainelTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.barbeiro("santiago"))

    def novo(self, **campos):
        corpo = {"nome": "Ana", "telefone": "43999998888", "servicos": [CABELO], "profissionalId": "santiago",
                 "data": proxima(2).isoformat(), "inicio": "10:00", **campos}
        return self.chamar("post", "/api/painel/agendamentos", corpo)

    def test_estado_no_formato_do_front(self):
        self.novo()
        _, estado = self.chamar("get", "/api/painel/estado")
        self.assertEqual(set(estado), {"ok", "hoje", "ferramentasDeTeste", "eu", "profissionais", "agendamentos", "ausencias", "bloqueios",
                                       "expedientes", "servicos", "produtos"})
        self.assertEqual(estado["expedientes"]["santiago"]["2"],
                         {"inicio": "09:00", "fim": "18:00", "pausaInicio": "12:00", "pausaFim": "13:00"})
        self.assertIsNone(estado["expedientes"]["santiago"]["0"])
        self.assertEqual(estado["agendamentos"][0]["servicos"], [CABELO])

    def test_serie_semanal_e_cancelar_um_dia(self):
        _, resposta = self.novo(repeticao={"frequencia": "semanal", "vezes": 3})
        self.assertEqual(len(resposta["datas"]), 3)
        id, segunda_data = resposta["agendamento"]["id"], resposta["datas"][1]

        self.chamar("post", f"/api/painel/agendamentos/{id}/cancelar", {"data": segunda_data})
        self.assertEqual(list(Excecao.objects.values_list("data", flat=True)),
                         [timezone.datetime.fromisoformat(segunda_data).date()])
        # O horário cancelado fica livre de novo.
        _, outro = self.novo(nome="Bruno", data=segunda_data)
        self.assertTrue(outro["ok"])

    def test_serie_recusa_se_uma_das_datas_estiver_ocupada(self):
        terca = proxima(2)
        self.novo(data=(terca + timedelta(days=14)).isoformat())
        status, resposta = self.novo(nome="Bruno", repeticao={"frequencia": "semanal", "vezes": 4})
        self.assertEqual((status, resposta["erro"]), (400, "Esse horário não está mais livre. Escolha outro."))

    def test_tornar_recorrente(self):
        _, resposta = self.novo()
        id = resposta["agendamento"]["id"]
        _, resposta = self.chamar("post", f"/api/painel/agendamentos/{id}/recorrente",
                                  {"repeticao": {"frequencia": "quinzenal", "vezes": 3}})
        self.assertEqual(resposta["agendamento"]["id"], id)  # é futuro: o próprio vira o primeiro da série
        self.assertEqual(resposta["agendamento"]["repeticao"], {"frequencia": "quinzenal", "vezes": 3})

        _, resposta = self.chamar("post", f"/api/painel/agendamentos/{id}/recorrente",
                                  {"repeticao": {"frequencia": "semanal", "vezes": 2}})
        self.assertEqual(resposta["erro"], "Este atendimento já se repete.")

    def test_simular_mudanca_de_expediente_avisa_e_nao_grava(self):
        self.novo(inicio="16:00")
        dias = {"2": {"inicio": "09:00", "fim": "15:00", "pausaInicio": "", "pausaFim": ""}}
        _, resposta = self.chamar("put", "/api/painel/expedientes/santiago", {"dias": dias, "simular": True})
        [conflito] = resposta["conflitos"]
        self.assertEqual((conflito["cliente"], conflito["profissionalId"], conflito["inicio"], conflito["motivo"]),
                         ("Ana", "santiago", "16:00", "Fora do expediente"))
        _, estado = self.chamar("get", "/api/painel/estado")
        self.assertEqual(estado["expedientes"]["santiago"]["2"]["fim"], "18:00")  # nada mudou

        # "Salvar mesmo assim": grava, e o atendimento continua na agenda.
        self.chamar("put", "/api/painel/expedientes/santiago", {"dias": dias})
        _, estado = self.chamar("get", "/api/painel/estado")
        self.assertEqual(estado["expedientes"]["santiago"]["2"]["fim"], "15:00")
        self.assertIsNone(estado["expedientes"]["santiago"]["3"])  # dia que não veio vira folga
        self.assertEqual(len(estado["agendamentos"]), 1)

    def test_bloqueio_e_ausencia(self):
        terca = proxima(2).isoformat()
        _, resposta = self.chamar("post", "/api/painel/bloqueios", {"data": terca, "motivo": "Feriado"})
        self.assertEqual(resposta["conflitos"], [])
        status, resposta = self.novo(data=terca)
        self.assertEqual(status, 400)

        _, resposta = self.chamar("post", "/api/painel/ausencias",
                                  {"profissionalId": "santiago", "inicio": terca, "fim": terca, "horaInicio": "10:00"})
        self.assertEqual(resposta["erro"], "Para ausência parcial, informe as duas horas em ordem.")

    def test_servicos(self):
        _, resposta = self.chamar("post", "/api/painel/servicos",
                                  {"nome": "Pigmentação", "preco": 40, "duracao": 45, "icone": "gota"})
        id = resposta["servico"]["id"]
        _, resposta = self.chamar("post", "/api/painel/servicos", {"nome": "cabelo", "preco": 10, "duracao": 15})
        self.assertEqual(resposta["erro"], "Já existe um serviço com esse nome.")
        _, resposta = self.chamar("post", "/api/painel/servicos", {"nome": "Luzes", "preco": 10, "duracao": 22})
        self.assertEqual(resposta["erro"], "Escolha a duração do serviço.")
        _, resposta = self.chamar("post", "/api/painel/servicos", {"nome": "Luzes", "preco": 10, "duracao": 245})
        self.assertEqual(resposta["erro"], "Escolha a duração do serviço.")
        _, resposta = self.chamar("put", f"/api/painel/servicos/{id}", {"nome": "Pigmentação", "preco": 40, "duracao": 20})
        self.assertTrue(resposta["ok"])

        # Mudar o preço não altera quem já marcou.
        self.novo()
        self.chamar("put", f"/api/painel/servicos/{CABELO}", {"nome": "Cabelo", "preco": 35, "duracao": 30})
        self.assertEqual(float(Agendamento.objects.get().preco), 30.0)

        for servico in [id, CABELO, BARBA]:
            self.chamar("delete", f"/api/painel/servicos/{servico}")
        _, resposta = self.chamar("delete", f"/api/painel/servicos/{SOBRANCELHA}")
        self.assertEqual(resposta["erro"], "Mantenha pelo menos um serviço para os clientes escolherem.")
        self.assertEqual(Servico.objects.filter(removido=False).count(), 1)

    def test_produtos(self):
        _, resposta = self.chamar("post", "/api/painel/produtos", {"nome": "Shampoo", "preco": "19.9"})
        id = resposta["produto"]["id"]
        _, resposta = self.chamar("put", f"/api/painel/produtos/{id}", {"nome": "Shampoo", "preco": 0})
        self.assertEqual(resposta["erro"], "Informe um preço maior que zero.")
        self.chamar("delete", f"/api/painel/produtos/{id}")
        _, resposta = self.chamar("get", "/api/publico/vitrine")
        self.assertEqual(len(resposta["produtos"]), 2)


def foto_jpeg():
    arquivo = BytesIO()
    Image.new("RGB", (40, 30), "goldenrod").save(arquivo, "JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(arquivo.getvalue()).decode()


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix="midia-teste-"))
class FotoDoProdutoTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.barbeiro("santiago"))

    def test_foto_vira_arquivo_e_some_ao_remover(self):
        _, resposta = self.chamar("post", "/api/painel/produtos", {"nome": "Cera", "preco": 30, "foto": foto_jpeg()})
        produto = resposta["produto"]
        self.assertRegex(produto["foto"], r"^/midia/produtos/produto.*\.jpg$")
        caminho = os.path.join(settings.MEDIA_ROOT, produto["foto"].removeprefix("/midia/"))
        self.assertTrue(os.path.exists(caminho))

        # Editar sem mandar a foto mantém a mesma; mandar null tira.
        _, resposta = self.chamar("put", f"/api/painel/produtos/{produto['id']}", {"nome": "Cera fosca", "preco": 30})
        self.assertEqual(resposta["produto"]["foto"], produto["foto"])
        _, resposta = self.chamar("put", f"/api/painel/produtos/{produto['id']}", {"nome": "Cera", "preco": 30, "foto": None})
        self.assertIsNone(resposta["produto"]["foto"])
        self.assertFalse(os.path.exists(caminho))

    def test_recusa_o_que_nao_e_imagem(self):
        falsa = "data:image/jpeg;base64," + base64.b64encode(b"<script>nada a ver</script>").decode()
        _, resposta = self.chamar("post", "/api/painel/produtos", {"nome": "Cera", "preco": 30, "foto": falsa})
        self.assertEqual(resposta["erro"], "Não deu para ler essa foto.")
        _, resposta = self.chamar("post", "/api/painel/produtos", {"nome": "Cera", "preco": 30, "foto": "data:text/html;base64,AAAA"})
        self.assertEqual(resposta["erro"], "Use uma foto JPG, PNG ou WebP.")


class AcessoTests(ApiTestCase):
    def test_painel_exige_login_e_o_publico_nao(self):
        status, resposta = self.chamar("get", "/api/painel/estado")
        self.assertEqual((status, resposta["erro"]), (401, "Entre com seu usuário e senha."))
        self.assertEqual(self.chamar("post", "/api/painel/servicos", {"nome": "X"})[0], 401)
        self.assertEqual(self.chamar("get", "/api/publico/vitrine")[0], 200)

    def test_entrar_e_sair(self):
        self.barbeiro("damigo", senha="tesoura-afiada-77")
        status, resposta = self.chamar("post", "/api/painel/entrar", {"usuario": "damigo", "senha": "tesoura-afiada-77"})
        self.assertEqual(status, 200)
        self.assertEqual(resposta["eu"], {"usuario": "damigo", "nome": "Damigo", "profissionalId": "damigo",
                                          "administrador": False})
        self.assertEqual(self.chamar("get", "/api/painel/eu")[0], 200)

        self.chamar("post", "/api/painel/sair")
        self.assertEqual(self.chamar("get", "/api/painel/eu")[0], 401)

    def test_senha_errada_e_bloqueio_depois_de_5_tentativas(self):
        self.barbeiro("damigo", senha="tesoura-afiada-77")
        for _ in range(5):
            _, resposta = self.chamar("post", "/api/painel/entrar", {"usuario": "damigo", "senha": "chute"})
            self.assertEqual(resposta["erro"], "Usuário ou senha incorretos.")
        # Na 6ª, nem a senha certa entra.
        _, resposta = self.chamar("post", "/api/painel/entrar", {"usuario": "damigo", "senha": "tesoura-afiada-77"})
        self.assertEqual(resposta["erro"], "Muitas tentativas erradas. Espere 15 minutos e tente de novo.")

    def test_usuario_sem_cadastro_de_barbeiro_nao_entra(self):
        usuario = User.objects.create_user("curioso", password="uma-senha-boa-123")
        _, resposta = self.chamar("post", "/api/painel/entrar", {"usuario": "curioso", "senha": "uma-senha-boa-123"})
        self.assertEqual(resposta["erro"], "Este usuário não tem acesso ao painel.")
        self.client.force_login(usuario)
        self.assertEqual(self.chamar("get", "/api/painel/estado")[0], 403)

    def test_barbeiro_desativado_perde_o_acesso(self):
        self.client.force_login(self.barbeiro("damigo"))
        Profissional.objects.filter(pk="damigo").update(ativo=False)
        self.assertEqual(self.chamar("get", "/api/painel/estado")[0], 403)

    def test_cada_um_ve_so_os_proprios_valores(self):
        self.agendar(profissionalId="santiago", servicos=[CABELO])
        self.agendar(profissionalId="damigo", servicos=[BARBA])

        self.client.force_login(self.barbeiro("santiago"))
        _, estado = self.chamar("get", "/api/painel/estado")
        precos = {item["profissionalId"]: item["preco"] for item in estado["agendamentos"]}
        self.assertEqual(precos, {"santiago": 30.0, "damigo": None})
        self.assertEqual(estado["eu"]["profissionalId"], "santiago")

        # O administrador do sistema (o João, no suporte) vê tudo.
        self.client.force_login(User.objects.create_superuser("joao", password="uma-senha-boa-123"))
        _, estado = self.chamar("get", "/api/painel/estado")
        precos = {item["profissionalId"]: item["preco"] for item in estado["agendamentos"]}
        self.assertEqual(precos, {"santiago": 30.0, "damigo": 25.0})

    def test_marcar_para_o_colega_nao_mostra_o_valor(self):
        self.client.force_login(self.barbeiro("santiago"))
        _, resposta = self.chamar("post", "/api/painel/agendamentos", {
            "nome": "Ana", "telefone": "43999998888", "servicos": [CABELO], "profissionalId": "damigo",
            "data": proxima(2).isoformat(), "inicio": "10:00"})
        self.assertIsNone(resposta["agendamento"]["preco"])


class ReservaDuplaTests(TransactionTestCase):
    """Dois pedidos para o mesmo horário chegando juntos: só um pode passar.

    TransactionTestCase porque cada thread abre a própria conexão com o banco, e elas
    precisam enxergar o que a outra gravou.
    """

    fixtures = [DADOS_INICIAIS]

    def test_pedidos_simultaneos_no_mesmo_horario(self):
        data = proxima(2).isoformat()
        largada = threading.Barrier(2)
        resultados = []

        def pedir(nome):
            try:
                largada.wait()
                dados.criar_agendamento(nome=nome, telefone="43999998888", servicos=[CABELO],
                                        profissional_id="santiago", data=data, inicio="10:00")
                resultados.append("ok")
            except dados.Recusado:
                resultados.append("recusado")
            finally:
                connection.close()

        threads = [threading.Thread(target=pedir, args=(nome,)) for nome in ["Ana", "Bruno"]]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(sorted(resultados), ["ok", "recusado"])
        self.assertEqual(Agendamento.objects.count(), 1)
