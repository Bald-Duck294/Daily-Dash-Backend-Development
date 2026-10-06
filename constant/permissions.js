// constants/permissions.js

export const MODULES = {
    DASHBOARD: 'dashboard',
    LOCATIONS: 'locations',
    LOCATION_TYPES: 'location_types',
    USERS: 'users',
    ASSIGNMENTS: 'assignments',
    FACILITY_COMPANIES: 'facility_companies',
    REPORTS: 'reports',
    CLEANER_REVIEWS: 'cleaner_reviews',
    SCORE_MANAGEMENT: 'score_management',
    ROLE_MANAGEMENT: 'role_management',
    SLA_MANAGEMENT: 'sla_management',
};

export const ACTIONS = {
    VIEW: 'view',
    ADD: 'add',
    UPDATE: 'update',
    DELETE: 'delete',
};

// All valid permissions in the system
export const VALID_PERMISSIONS = [
    // Dashboard
    'dashboard.view',

    // Locations/Washrooms
    'locations.view',
    'locations.add',
    'locations.update',
    'locations.delete',
    'locations.toggle_status', // Special action

    // Location Types
    'location_types.view',
    'location_types.add',
    'location_types.update',
    'location_types.delete',

    // Users
    'users.view',
    'users.add',
    'users.update',
    'users.delete',

    // Assignments
    'assignments.view',
    'assignments.add',
    'assignments.update',
    'assignments.delete',
    'assignments.toggle_status', // Special action


    // Facility Companies
    'facility_companies.view',
    'facility_companies.add',
    'facility_companies.update',
    'facility_companies.delete',

    // Reports
    'reports.view',
    'reports.export', // Special action

    // Reviews
    'cleaner_reviews.view',
    'cleaner_reviews.manage', // Special action for managing reviews

    // Score Management
    'score_management.view',
    'score_management.update',

    // Role Management
    'role_management.view',
    'role_management.add',
    'role_management.update',
    'role_management.delete',

    // SLA Management
    'sla_management.view',
    'sla_management.add',
    'sla_management.update',
    'sla_management.delete',
];

// System roles that cannot be deleted (IDs 1-4)
export const SYSTEM_ROLE_IDS = [1, 2, 3, 4];

export const MODULE_CONFIG = [
    {
        key: MODULES.DASHBOARD,
        label: 'Dashboard',
        description: 'Main dashboard and analytics',
        permissions: ['dashboard.view'],
    },
    {
        key: MODULES.LOCATIONS,
        label: 'Washrooms/Locations',
        description: 'Manage washroom locations',
        permissions: [
            'locations.view',
            'locations.add',
            'locations.update',
            'locations.delete',
            'locations.toggle_status',
        ],
    },
    {
        key: MODULES.LOCATION_TYPES,
        label: 'Location Hierarchy',
        description: 'Manage location types and zones',
        permissions: [
            'location_types.view',
            'location_types.add',
            'location_types.update',
            'location_types.delete',
        ],
    },
    {
        key: MODULES.USERS,
        label: 'User Management',
        description: 'Manage users (cleaners, supervisors)',
        permissions: [
            'users.view',
            'users.add',
            'users.update',
            'users.delete',
        ],
    },
    {
        key: MODULES.ASSIGNMENTS,
        label: 'User Mapping',
        description: 'Assign users to locations',
        permissions: [
            'assignments.view',
            'assignments.add',
            'assignments.update',
            'assignments.delete',
            'assignments.toggle_status', // Special action
        ],
    },
    {
        key: MODULES.FACILITY_COMPANIES,
        label: 'Facility Companies',
        description: 'Manage facility companies',
        permissions: [
            'facility_companies.view',
            'facility_companies.add',
            'facility_companies.update',
            'facility_companies.delete',
        ],
    },
    {
        key: MODULES.REPORTS,
        label: 'Reports',
        description: 'View and export reports',
        permissions: [
            'reports.view',
            'reports.export',
        ],
    },
    {
        key: MODULES.CLEANER_REVIEWS,
        label: 'Reviews & Activity',
        description: 'Cleaner activity and  reviews',
        permissions: [
            'cleaner_reviews.view',
            'cleaner_reviews.manage',
        ],
    },
    {
        key: MODULES.SCORE_MANAGEMENT,
        label: 'Score Management',
        description: 'Manage scoring system',
        permissions: [
            'score_management.view',
            'score_management.update',
        ],
    },
    {
        key: MODULES.ROLE_MANAGEMENT,
        label: 'Role Management',
        description: 'Manage roles and permissions',
        permissions: [
            'role_management.view',
            'role_management.add',
            'role_management.update',
            'role_management.delete',
        ],
    },
    {
        key: MODULES.SLA_MANAGEMENT,
        label: 'SLA Management',
        description: 'Configure and monitor SLA thresholds, escalations, and incident logs',
        permissions: [
            'sla_management.view',
            'sla_management.add',
            'sla_management.update',
            'sla_management.delete',
        ],
    },
];


