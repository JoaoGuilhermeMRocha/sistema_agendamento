from django.conf import settings
from django.core.management.base import BaseCommand

from barbearia.dados import anonimizar_antigos


class Command(BaseCommand):
    help = "LGPD: tira nome e WhatsApp de quem não tem atendimento há mais que o prazo de guarda (LGPD_GUARDA_DIAS)."

    def handle(self, *args, **opcoes):
        total = anonimizar_antigos()
        self.stdout.write(f"{total} atendimento(s) anonimizado(s) (prazo: {settings.LGPD_GUARDA_DIAS} dias).")
