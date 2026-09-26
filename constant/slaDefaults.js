export const DEFAULT_ESCALATION_LEVELS = [
    {
        level: 1,
        target_role: "cleaner",
        delay_minutes: 0,
        send_notification: true
    },
    {
        level: 2,
        target_role: "supervisor",
        delay_minutes: 120,
        send_notification: true
    },
    {
        level: 3,
        target_role: "admin",
        delay_minutes: 240,
        send_notification: true
    }
];

export const DEFAULT_SLA_CONFIGURATION = {
    version: 1,
    threshold_score: 8,
    max_retry_attempts: 2,
    notify_cleaner: true,
    notify_supervisor: true,
    max_score_updates_per_activity: 1,
    escalation: {
        enabled: true,
        levels: DEFAULT_ESCALATION_LEVELS
    }
};

