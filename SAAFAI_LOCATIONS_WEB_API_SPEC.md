# SaafAI Public Locations Web API Specification (`/api/locations/saafai_locations`)

## 1. Overview & Architectural Role

| Attribute | Details |
| :--- | :--- |
| **Endpoint URL** | `GET /api/locations/saafai_locations` |
| **Live Development URL** | `https://daily-dash-backend-development.vercel.app/api/locations/saafai_locations?company_id=24` |
| **Route Definition** | [`dash-backend/routes/LocationRoutes.js`](file:///d:/Dash-saafAi/Daily-Dash-Main/dash-backend/routes/LocationRoutes.js#L27) |
| **Controller Handler** | [`dash-backend/controller/LocationsController.js` -> `getAllToiletsForWeb`](file:///d:/Dash-saafAi/Daily-Dash-Main/dash-backend/controller/LocationsController.js#L2150-L2324) |
| **Prisma Model** | `prisma.locations` |
| **Authentication** | **Public** (No JWT / `verifyToken` middleware required) |
| **Primary Consumer** | **Public Consumer Website & Mobile Web Directory** (used by citizens/visitors to discover, navigate to, and view washroom amenities). This API is **not** used by the internal administration dashboard. |

---

## 2. Filters Breakdown (Core Focus)

The API combines **hardcoded business rules** with **dynamic query parameter filters** and **relation-level sub-filters**:

```
                              Incoming Request
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
          Hardcoded Base Filters           Query Parameter Filters
        ┌─────────────────────────┐       ┌────────────────────────┐
        │ is_public: true         │       │ company_id (optional)  │
        │ status: true OR null *  │       │ type_id    (optional)  │
        └─────────────────────────┘       │ include_unavailable    │
                     │                    └────────────────────────┘
                     └───────────────┬───────────────┘
                                     ▼
                          Prisma Database Query
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
        hygiene_scores Sub-filter       cleaner_assignments Sub-filter
        ┌─────────────────────────┐     ┌────────────────────────┐
        │ created_at >= Today 00h │     │ deleted_at: null       │
        │ created_at <= Today 23h │     │ cleaner_user.role_id=5 │
        │ take: 1 (Latest only)   │     │ order: assigned_on DESC│
        └─────────────────────────┘     └────────────────────────┘
```

### A. Hardcoded Filters (Always Applied)

1. **Public Visibility Enforcement (`is_public: true`):**
   ```javascript
   const whereClause = {
     is_public: true,
   };
   ```
   - **Why:** Ensures that internal, private, administrative, or restricted facility washrooms are **never** exposed to the public-facing website.
   - Any location where `is_public === false` or `is_public === null` is excluded at the database layer.

2. **Default Active Status Enforcement (`status`):**
   ```javascript
   if (include_unavailable !== "true") {
     whereClause.OR = [{ status: true }, { status: null }];
   }
   ```
   - **Why:** Washrooms that are temporarily shut down, under maintenance, or deactivated (`status === false`) are hidden from citizens by default.
   - Only washrooms explicitly active (`status === true`) or untoggled legacy entries (`status === null`) are shown.

---

### B. Dynamic Query Parameter Filters

| Query Parameter | Type | Required | Description & Prisma Logic | Example Usage |
| :--- | :--- | :--- | :--- | :--- |
| `company_id` | `string \| number` | Optional | Scopes washrooms to a specific tenant / client company.<br>`whereClause.company_id = BigInt(company_id)` | `?company_id=24` |
| `type_id` | `string \| number` | Optional | Filters washrooms by location type / category / zone.<br>`whereClause.type_id = BigInt(type_id)` | `?company_id=24&type_id=182` |
| `include_unavailable` | `string` (`"true"`) | Optional | If set to `"true"`, bypasses the default status check and returns all washrooms regardless of whether `status` is `true`, `false`, or `null`. | `?company_id=24&include_unavailable=true` |

---

### C. Relation Sub-Filters (Eager Loaded)

When locations are fetched, Prisma eager-loads child tables with specific scoping rules:

#### 1. Today's Hygiene Score (`hygiene_scores`)
- **Date Filter:**
  ```javascript
  created_at: {
    gte: startOfDay, // Current date at 00:00:00.000
    lte: endOfDay,   // Current date at 23:59:59.999
  }
  ```
- **Ordering & Limit:** `orderBy: { created_at: "desc" }, take: 1`
- **Result:** Provides `currentScore` (the latest AI/hygiene score recorded today). If no score was generated today, `currentScore` returns `null`.

#### 2. Cleaner Reviews (`cleaner_reviews`)
- **Selected Fields:** `{ score: true }`
- **Aggregation:** Aggregates all cleaner inspection scores to calculate:
  - `ratingCount`: Total count of reviews recorded.
  - `averageRating`: `(sum of scores) / ratingCount` (formatted to 2 decimal places).

#### 3. Active Cleaner Assignments (`cleaner_assignments`)
- **Sub-filters:**
  ```javascript
  where: {
    deleted_at: null,
    cleaner_user: {
      role_id: 5 // Role 5 = Cleaner
    }
  }
  ```
- **Ordering:** `orderBy: { assigned_on: "desc" }`
- **Selected Fields:** Assignment ID, status, assigned date, and cleaner user info (`id`, `name`, `email`, `phone`).

#### 4. Metadata Entities
- `location_types`: Selects `{ id, name }`.
- `facility_companies`: Selects `{ id, name }`.

---

## 3. Query Sorting & Pagination

- **Sorting:** `orderBy: { created_at: "desc" }` (Newest washrooms listed first).
- **Pagination:** **Unpaginated**. The endpoint returns an array of all matching public washrooms in a single payload to enable client-side map clustering and radius filtering on the website.

---

## 4. Response Payload Schema

```json
[
  {
    "id": "390",
    "name": "Maharaja Baug Public Restroom",
    "parent_id": null,
    "company_id": "24",
    "type_id": "182",
    "latitude": 21.0836827,
    "longitude": 79.0746247,
    "address": "Opposite Gate 2, Maharaja Baug Road",
    "city": "Nagpur",
    "state": "Maharashtra",
    "pincode": "440001",
    "status": true,
    "is_public": true,
    "open_time": "06:00:00",
    "close_time": "22:00:00",
    "options": {
      "isPaid": true,
      "is24Hours": false,
      "genderAccess": ["male", "female", "unisex", "differently_abled"],
      "hasAttendant": true,
      "hasSanitaryProducts": true,
      "hasBabyFeeding": false,
      "wheelchairAccessible": true
    },
    "images": [
      "https://storage.googleapis.com/.../photo1.webp"
    ],
    "averageRating": 8.45,
    "ratingCount": 124,
    "currentScore": 9.1,
    "location_types": {
      "id": "182",
      "name": "Public Urban Restroom"
    },
    "facility_companies": {
      "id": "12",
      "name": "CleanCity Facilities Pvt Ltd"
    },
    "cleaner_assignments": [
      {
        "id": "512",
        "status": true,
        "assigned_on": "2026-10-15T08:00:00.000Z",
        "cleaner_user": {
          "id": "88",
          "name": "Sunil Kumar",
          "email": "sunil@cleaner.saaf.ai",
          "phone": "9876543210"
        }
      }
    ]
  }
]
```

---

## 5. Key Comparisons: Web API vs. Dashboard API

| Characteristic | `/api/locations/saafai_locations` (Web API) | `/api/locations/` (Dashboard API) |
| :--- | :--- | :--- |
| **Target Audience** | Citizens, tourists, public map viewers | Company admins, supervisors, superadmins |
| **Authentication** | None (Publicly open) | Required (`Bearer JWT` via `verifyToken`) |
| **`is_public` Filter** | **Strictly enforced (`true` only)** | Views both public and internal washrooms |
| **Unavailable Toilets** | Hidden by default (`status: true \| null`) | Shown with toggle action controls |
| **Cleaner Scoping** | Only active cleaner assignments (`role_id: 5`) | Includes supervisors, history, and full audit |
| **Ratings Included** | Pre-calculated `averageRating` & today's `currentScore` | Granular breakdown with penalty histories |
