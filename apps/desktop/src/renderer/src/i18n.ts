/** Minimal i18n dictionary (EN + AR with RTL support). */
export const STRINGS = {
  en: {
    app_title: "Jarvis OS",
    nav_dashboard: "Dashboard",
    nav_command: "Command",
    nav_history: "History",
    nav_security: "Security",
    nav_memory: "Memory",
    nav_settings: "Settings",
    commandbar_placeholder: "Ask Jarvis anything…  (Ctrl+K)",
    run: "Run",
    deny: "Deny",
    approve: "Approve",
    cancel: "Cancel",
    risk: "Risk",
    step: "Step",
    awaiting_confirmation: "Step requires your confirmation",
    engine_offline: "Engine offline — build the Rust core to execute tasks",
    service_offline: "AI service offline — start services/ai-orchestrator",
    dashboard_title: "Today",
    history_title: "Task history",
    security_title: "Security center",
    memory_title: "Memory",
    settings_title: "Settings",
    audit_chain_ok: "Audit chain verified ✔",
    audit_chain_broken: "⚠ Audit chain integrity FAILED",
    blocked_label: "Blocked",
    tasks: "tasks",
  },
  ar: {
    app_title: "جارفيس OS",
    nav_dashboard: "لوحة اليوم",
    nav_command: "الأوامر",
    nav_history: "السجل",
    nav_security: "الأمن",
    nav_memory: "الذاكرة",
    nav_settings: "الإعدادات",
    commandbar_placeholder: "اسأل جارفيس…  (Ctrl+K)",
    run: "تشغيل",
    deny: "رفض",
    approve: "موافقة",
    cancel: "إلغاء",
    risk: "الخطر",
    step: "خطوة",
    awaiting_confirmation: "تثير الخطوة تأكيدك",
    engine_offline: "المحرك معطّل — ابنِ نواة Rust لتشغيل المهام",
    service_offline: "خدمة الذكاء معطّلة — شغّل services/ai-orchestrator",
    dashboard_title: "اليوم",
    history_title: "سجل المهام",
    security_title: "مركز الأمن",
    memory_title: "الذاكرة",
    settings_title: "الإعدادات",
    audit_chain_ok: "تم التحقق من سلسلة التدقيق ✔",
    audit_chain_broken: "⚠ سلامة سلسلة التدقيق مكسورة",
    blocked_label: "محظور",
    tasks: "مهام",
  },
} as const;

export type Lang = keyof typeof STRINGS;

export type TKey = keyof (typeof STRINGS)["en"];
export type Translate = (key: TKey) => string;

export function makeT(lang: Lang): Translate {
  return (key: TKey): string => {
    const dict = STRINGS[lang] as Record<string, string>;
    return dict[key] ?? (STRINGS.en as Record<string, string>)[key] ?? String(key);
  };
}
