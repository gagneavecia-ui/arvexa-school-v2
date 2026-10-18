// ================================================================
// BAC-DATE.JS — ARVEXA School
// Date officielle du BAC D au Niger
// ⚡ Modifier UNIQUEMENT ce fichier chaque année
// ================================================================

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  // CONFIGURATION — À MODIFIER CHAQUE ANNÉE
  // ══════════════════════════════════════════════════════════════
  // month : mois (0 = janvier, 1 = février, ..., 5 = juin, 6 = juillet)
  // day   : jour du mois (1 à 31)
  //
  // Exemples :
  //   { month: 5, day: 1 }   → 1er juin
  //   { month: 5, day: 12 }  → 12 juin
  //   { month: 6, day: 3 }   → 3 juillet
  // ══════════════════════════════════════════════════════════════

  window.ARVEXA_BAC_DATE = {
    month: 6,      // 5 = juin
    day: 14,        // 1 = 1er juin
    label: 'BAC'   // Étiquette affichée (optionnel)
  };

  // ══════════════════════════════════════════════════════════════
  // FONCTION UTILITAIRE — Retourne la prochaine date du BAC
  // ══════════════════════════════════════════════════════════════
  window.ARVEXA_getExamDate = function () {
    var cfg = window.ARVEXA_BAC_DATE || { month: 5, day: 1 };
    var now = new Date();
    var year = now.getFullYear();
    var examThisYear = new Date(year, cfg.month, cfg.day);

    if (now < examThisYear) return examThisYear;
    return new Date(year + 1, cfg.month, cfg.day);
  };

  // ══════════════════════════════════════════════════════════════
  // FONCTION UTILITAIRE — Retourne l'année du BAC cible
  // ══════════════════════════════════════════════════════════════
  window.ARVEXA_getBacYear = function () {
    var cfg = window.ARVEXA_BAC_DATE || { month: 5, day: 1 };
    var now = new Date();
    var year = now.getFullYear();
    var examThisYear = new Date(year, cfg.month, cfg.day);

    return now < examThisYear ? year : year + 1;
  };

})();
