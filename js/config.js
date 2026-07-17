/* ═══════════════════════════════════════════════════════════════
   config.js — Regras do Memorando de Gestão de Alterações GTFS
   CIM Tâmega e Sousa · V12.2025
   Ajustar aqui as regras sem tocar na lógica da aplicação (app.js).
   ═══════════════════════════════════════════════════════════════ */
'use strict';

/* ═══════════════════════════════════════════════════════════════
   CONFIGURAÇÃO DAS REGRAS (Memorando V12.2025)
   ═══════════════════════════════════════════════════════════════ */
const FICHEIROS_MINIMOS = [
  "agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt",
  "calendar.txt", "calendar_dates.txt", "shapes.txt", "transfers.txt", "feed_info.txt",
];
const FICHEIRO_AUXILIAR = "patterns_shapeid.txt";
const PREFIXO_LOTE  = /^(UT[1-4])_/i;
const REGEX_STOP_ID = /^[a-z]{2,5}_[0-9]+$/;
const REGEX_HORA    = /^\d{1,2}:\d{2}:\d{2}$/;
const DIAS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];

// Envolvente aproximada de Portugal continental (WGS84)
const LAT_MIN = 36.8, LAT_MAX = 42.2, LON_MIN = -9.6, LON_MAX = -6.1;

const LIMITE_LISTA = 400; // máximo de itens mostrados por lista de detalhe
