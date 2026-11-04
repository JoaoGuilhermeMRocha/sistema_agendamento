"""Testes das regras da agenda (barbearia/agenda.py).

Rode com: uv run python manage.py test barbearia

O "agora" dos testes é fixo: segunda, 02/11/2026, 10h. Assim os resultados não mudam com o dia.
"""

from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from django.test import SimpleTestCase, TestCase

from barbearia import agenda
from barbearia.agenda import Atendimento, Ausencia, Bloqueio, Estado, Expediente
from barbearia.models import Agendamento, Excecao, Profissional

AGORA = datetime(2026, 11, 2, 10, 0, tzinfo=ZoneInfo("America/Sao_Paulo"))  # segunda
TERCA = date(2026, 11, 3)
QUARTA = date(2026, 11, 4)


def h(texto):
    """'09:30' -> 570 minutos."""
    return agenda.minutos(time.fromisoformat(texto))


def estado(**extras):
    """Santiago e Damigo, de terça a sexta das 9h às 18h com pausa das 12h às 13h, sábado das 9h às 16h."""
    dia_util = Expediente(h("09:00"), h("18:00"), h("12:00"), h("13:00"))
    semana = {2: dia_util, 3: dia_util, 4: dia_util, 5: dia_util, 6: Expediente(h("09:00"), h("16:00"))}
    return Estado(
        agora=AGORA,
        profissionais=["santiago", "damigo"],
        expedientes={"santiago": dict(semana), "damigo": dict(semana)},
        **extras,
    )


def atendimento(id=1, profissional="santiago", data=TERCA, inicio="09:00", duracao=30, **extras):
    return Atendimento(id=id, profissional=profissional, data=data, inicio=h(inicio), duracao=duracao, **extras)


class RecorrenciaTests(SimpleTestCase):
    def test_semanal_repete_de_7_em_7_dias(self):
        self.assertEqual(
            agenda.datas_da_serie(TERCA, "semanal", 3),
            [date(2026, 11, 3), date(2026, 11, 10), date(2026, 11, 17)],
        )

    def test_quinzenal_repete_de_14_em_14_dias(self):
        self.assertEqual(agenda.datas_da_serie(TERCA, "quinzenal", 2), [date(2026, 11, 3), date(2026, 11, 17)])

    def test_mensal_segue_o_dia_da_semana_do_mes(self):
        # 17/11 é a 3ª terça: a série cai sempre na 3ª terça.
        self.assertEqual(
            agenda.datas_da_serie(date(2026, 11, 17), "mensal", 3),
            [date(2026, 11, 17), date(2026, 12, 15), date(2027, 1, 19)],
        )

    def test_mensal_na_quinta_semana_vira_a_ultima_do_mes(self):
        # 29/12 é a 5ª terça de dezembro; janeiro e fevereiro só têm 4, então vale a última.
        self.assertEqual(
            agenda.datas_da_serie(date(2026, 12, 29), "mensal", 3),
            [date(2026, 12, 29), date(2027, 1, 26), date(2027, 2, 23)],
        )

    def test_sem_data_para_terminar_vai_ate_o_horizonte(self):
        datas = agenda.datas_da_serie(TERCA, "semanal", None)
        self.assertEqual(len(datas), 26)  # 180 dias / 7 = 25 semanas e pouco, mais a primeira
        self.assertLessEqual((datas[-1] - TERCA).days, 180)

    def test_ocorre_em_respeita_excecao_encerramento_e_vezes(self):
        serie = atendimento(frequencia="semanal", vezes=4, excecoes=frozenset({date(2026, 11, 10)}))
        self.assertTrue(agenda.ocorre_em(serie, date(2026, 11, 3)))
        self.assertFalse(agenda.ocorre_em(serie, date(2026, 11, 10)))  # cancelado
        self.assertTrue(agenda.ocorre_em(serie, date(2026, 11, 24)))   # 4º atendimento
        self.assertFalse(agenda.ocorre_em(serie, date(2026, 12, 1)))   # passou das 4 vezes
        self.assertFalse(agenda.ocorre_em(serie, date(2026, 11, 4)))   # não é terça

        encerrada = atendimento(frequencia="semanal", vezes=None, ate=date(2026, 11, 17))
        self.assertTrue(agenda.ocorre_em(encerrada, date(2026, 11, 10)))
        self.assertFalse(agenda.ocorre_em(encerrada, date(2026, 11, 17)))

    def test_inicio_da_recorrencia(self):
        futuro = atendimento(data=TERCA)
        self.assertEqual(agenda.inicio_da_recorrencia(estado(), futuro, "semanal"), TERCA)

        # Foi na segunda passada: a série nasce hoje, se o horário ainda não passou...
        passado = atendimento(data=date(2026, 10, 26), inicio="15:00")
        self.assertEqual(agenda.inicio_da_recorrencia(estado(), passado, "semanal"), date(2026, 11, 2))
        # ...ou na semana seguinte, se já passou (agora são 10h).
        cedo = atendimento(data=date(2026, 10, 26), inicio="09:00")
        self.assertEqual(agenda.inicio_da_recorrencia(estado(), cedo, "semanal"), date(2026, 11, 9))


class DisponibilidadeTests(SimpleTestCase):
    def test_motivos_de_indisponibilidade(self):
        base = estado()
        self.assertEqual(agenda.motivo_indisponivel(base, "santiago", date(2026, 11, 2), h("10:00"), 30),
                         "Dia de folga do profissional")
        self.assertEqual(agenda.motivo_indisponivel(base, "santiago", TERCA, h("08:30"), 30), "Fora do expediente")
        self.assertEqual(agenda.motivo_indisponivel(base, "santiago", TERCA, h("17:45"), 30), "Fora do expediente")
        self.assertEqual(agenda.motivo_indisponivel(base, "santiago", TERCA, h("11:45"), 30), "Na pausa do profissional")
        self.assertIsNone(agenda.motivo_indisponivel(base, "santiago", TERCA, h("17:30"), 30))

    def test_bloqueio_de_dia_inteiro_e_parcial(self):
        feriado = estado(bloqueios=[Bloqueio(TERCA, "Feriado")])
        self.assertEqual(agenda.motivo_indisponivel(feriado, "damigo", TERCA, h("10:00"), 30), "Bloqueio: Feriado")

        reuniao = estado(bloqueios=[Bloqueio(TERCA, "Reunião", h("14:00"), h("15:00"))])
        self.assertEqual(agenda.motivo_indisponivel(reuniao, "damigo", TERCA, h("14:30"), 30), "Bloqueio: Reunião")
        self.assertIsNone(agenda.motivo_indisponivel(reuniao, "damigo", TERCA, h("15:00"), 30))

    def test_ausencia_vale_so_para_o_profissional(self):
        ferias = estado(ausencias=[Ausencia("santiago", TERCA, QUARTA)])
        self.assertEqual(agenda.motivo_indisponivel(ferias, "santiago", QUARTA, h("10:00"), 30), "Profissional ausente")
        self.assertIsNone(agenda.motivo_indisponivel(ferias, "damigo", QUARTA, h("10:00"), 30))

    def test_horario_ocupado_e_horario_encostado(self):
        base = estado(atendimentos=[atendimento(inicio="09:00", duracao=30)])
        self.assertFalse(agenda.profissional_livre(base, "santiago", TERCA, h("09:15"), 30))
        self.assertTrue(agenda.profissional_livre(base, "santiago", TERCA, h("09:30"), 30))  # começa quando o outro acaba
        self.assertTrue(agenda.profissional_livre(base, "damigo", TERCA, h("09:00"), 30))
        # Ao editar, o próprio atendimento não conta como conflito.
        self.assertTrue(agenda.profissional_livre(base, "santiago", TERCA, h("09:00"), 30, ignorar_id=1))

    def test_horario_que_ja_passou_nao_esta_livre(self):
        # Hoje (segunda) é folga no expediente padrão: abre a segunda para testar só o horário.
        base = estado()
        base.expedientes["santiago"][1] = Expediente(h("09:00"), h("18:00"))
        self.assertFalse(agenda.profissional_livre(base, "santiago", date(2026, 11, 2), h("09:30"), 30))
        self.assertFalse(agenda.profissional_livre(base, "santiago", date(2026, 11, 2), h("10:00"), 30))
        self.assertTrue(agenda.profissional_livre(base, "santiago", date(2026, 11, 2), h("10:15"), 30))

    def test_serie_ocupa_as_proximas_semanas(self):
        serie = atendimento(frequencia="semanal", vezes=None)
        base = estado(atendimentos=[serie])
        self.assertFalse(agenda.profissional_livre(base, "santiago", date(2026, 12, 29), h("09:00"), 30))


class EscolhaDeProfissionalTests(SimpleTestCase):
    def test_sem_preferencia_escolhe_quem_tem_menos_atendimentos_no_dia(self):
        base = estado(atendimentos=[atendimento(profissional="santiago", inicio="15:00")])
        self.assertEqual(agenda.escolher_profissional(base, None, [TERCA], h("10:00"), 30), "damigo")

    def test_empate_fica_com_o_primeiro_da_lista(self):
        self.assertEqual(agenda.escolher_profissional(estado(), None, [TERCA], h("10:00"), 30), "santiago")

    def test_com_preferencia_so_serve_o_escolhido(self):
        base = estado(atendimentos=[atendimento(profissional="damigo", inicio="10:00")])
        self.assertIsNone(agenda.escolher_profissional(base, "damigo", [TERCA], h("10:00"), 30))

    def test_serie_precisa_de_alguem_livre_em_todas_as_datas(self):
        # Santiago está ausente na segunda terça da série: só o Damigo serve.
        base = estado(ausencias=[Ausencia("santiago", date(2026, 11, 10), date(2026, 11, 10))])
        datas = agenda.datas_da_serie(TERCA, "semanal", 3)
        self.assertEqual(agenda.escolher_profissional(base, None, datas, h("10:00"), 30), "damigo")


class HorariosLivresTests(SimpleTestCase):
    def test_horarios_respeitam_pausa_e_fim_do_expediente(self):
        horarios = agenda.horarios_livres(estado(), TERCA, 60, profissional="santiago")
        self.assertEqual(horarios[0], h("09:00"))
        self.assertIn(h("11:00"), horarios)
        self.assertNotIn(h("11:15"), horarios)  # 11h15 + 1h invade a pausa
        self.assertNotIn(h("12:30"), horarios)
        self.assertEqual(horarios[-1], h("17:00"))  # o último que termina até as 18h

    def test_horario_some_so_quando_todos_estao_ocupados(self):
        um = estado(atendimentos=[atendimento(profissional="santiago", inicio="10:00")])
        self.assertIn(h("10:00"), agenda.horarios_livres(um, TERCA, 30))

        dois = estado(atendimentos=[
            atendimento(id=1, profissional="santiago", inicio="10:00"),
            atendimento(id=2, profissional="damigo", inicio="10:00"),
        ])
        self.assertNotIn(h("10:00"), agenda.horarios_livres(dois, TERCA, 30))

    def test_oferece_o_fim_de_cada_atendimento(self):
        base = estado(atendimentos=[atendimento(profissional="santiago", inicio="09:00", duracao=20)])
        horarios = agenda.horarios_livres(base, TERCA, 30, profissional="santiago")
        self.assertEqual(horarios[:3], [h("09:20"), h("09:30"), h("09:45")])
        # O fim do atendimento de um colega não entra quando o cliente escolheu outro profissional.
        self.assertNotIn(h("09:20"), agenda.horarios_livres(base, TERCA, 30, profissional="damigo"))

    def test_dia_de_folga_nao_tem_horario(self):
        self.assertEqual(agenda.horarios_livres(estado(), date(2026, 11, 8), 30), [])  # domingo
        self.assertTrue(agenda.dia_fechado(estado(), date(2026, 11, 8)))


class ConflitosTests(SimpleTestCase):
    def test_atendimento_que_ficou_fora_do_horario_vira_conflito(self):
        base = estado(atendimentos=[atendimento(data=QUARTA, inicio="16:00")])
        self.assertEqual(agenda.conflitos_futuros(base), [])

        # A barbearia passou a fechar às 15h na quarta: o atendimento das 16h fica em conflito.
        base.expedientes["santiago"][3] = Expediente(h("09:00"), h("15:00"))
        [(conflito, data, motivo)] = agenda.conflitos_futuros(base)
        self.assertEqual((conflito.id, data, motivo), (1, QUARTA, "Fora do expediente"))


class CarregarEstadoTests(TestCase):
    """Este usa o banco de teste (criado e apagado pelo Django a cada rodada)."""

    def test_carrega_do_banco_so_o_que_ainda_vale(self):
        santiago = Profissional.objects.create(id="santiago", nome="Santiago")
        santiago.expedientes.create(dia_semana=2, inicio=time(9), fim=time(18), pausa_inicio=time(12), pausa_fim=time(13))
        Profissional.objects.create(id="antigo", nome="Antigo", ativo=False)

        dados = dict(cliente_nome="Ana", cliente_telefone="43999998888", profissional=santiago, duracao=30, preco=30)
        passado = Agendamento.objects.create(data=date(2026, 10, 27), inicio=time(9), **dados)
        serie = Agendamento.objects.create(data=date(2026, 10, 27), inicio=time(10), frequencia="semanal", vezes=None, **dados)
        Excecao.objects.create(agendamento=serie, data=TERCA)

        carregado = agenda.carregar_estado(AGORA)
        self.assertEqual(carregado.profissionais, ["santiago"])
        self.assertEqual(carregado.expedientes["santiago"][2], Expediente(h("09:00"), h("18:00"), h("12:00"), h("13:00")))
        self.assertEqual([item.id for item in carregado.atendimentos], [serie.id])  # o avulso que passou fica de fora
        self.assertFalse(agenda.ocorre_em(carregado.atendimentos[0], TERCA))
        self.assertTrue(agenda.ocorre_em(carregado.atendimentos[0], date(2026, 11, 10)))
        self.assertNotIn(passado.id, [item.id for item in carregado.atendimentos])
