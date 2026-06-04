export type RequestStatus =
  | "open"
  | "approved"
  | "rejected"
  | "fulfilled"
  | "cancelled";

export type UserRole = "admin" | "technician" | "user" | "viewer" | "denied";

export interface Kit {
  id: string;
  serial: string;
  notes?: string;
  tags?: string;
  attachments?: string[];
  is_active: boolean;
  created: string;
  updated: string;
}

export type EntityCategory = "storage" | "field";

export interface Entity {
  id: string;
  name: string;
  description?: string;
  category: EntityCategory;
  is_active: boolean;
  created: string;
  updated: string;
}

export interface Transaction {
  id: string;
  kit: string;
  from_entity?: string;
  to_entity: string;
  timestamp: string;
  notes?: string;
  created_by: string;
  request?: string;
  created: string;
  updated: string;
  expand?: {
    kit?: Kit;
    from_entity?: Entity;
    to_entity?: Entity;
    created_by?: PBUser;
    request?: KitRequest;
  };
}

export interface KitRequest {
  id: string;
  requester: string;
  date: string;
  status: RequestStatus;
  designated_kit?: string;
  target_entity?: string;
  notes?: string;
  decision_notes?: string;
  expected_return?: string;
  delivery_date: string;
  created: string;
  updated: string;
  expand?: {
    requester?: PBUser;
    designated_kit?: Kit;
    target_entity?: Entity;
  };
}

export interface NotificationPrefs {
  channels: ("email" | "telegram")[];
  events: {
    request_fulfilled: boolean;
    kit_moved: boolean;
    maintenance_digest: boolean;
    overdue_return: boolean;
    request_pending: boolean;
    request_escalation: boolean;
  };
  quiet_hours?: {
    enabled: boolean;
    start: string;  // HH:MM
    end: string;    // HH:MM
    timezone: string; // IANA TZ
  };
}

export interface PBUser {
  id: string;
  email: string;
  name?: string;
  role: UserRole;
  entity?: string;
  phone?: string;
  title?: string;
  telegram_chat_id?: string;
  denial_notes?: string;
  notification_prefs?: string;
  created: string;
  updated: string;
}

export interface Product {
  id: string;
  name: string;
  category?: string;
  manufacturer?: string;
  model?: string;
  description?: string;
  specs?: string; // JSON string
  url?: string;
  is_serialized: boolean;
  track_in_status: boolean;
  reorder_point?: number | null;
  is_active: boolean;
  created: string;
  updated: string;
}

export interface Component {
  id: string;
  serial: string;
  notes: string;
  is_active: boolean;
  is_bulk: boolean;
  quantity: number | null;
  product: string; // relation id, now required
  bin_code: string; // optional shelf/bin label inside an entity; max 16 chars
  lot_code: string;     // optional lot/batch code; max 32 chars
  expires_at: string;   // optional expiry date; ISO "YYYY-MM-DD ..." or empty
  created: string;
  updated: string;
  expand?: { product?: Product };
}

export type AuditVia = "web" | "wa-bot" | "wa-meta-bot" | "ai-agent" | "mcp" | "tg-command" | "tg-link";

export interface AuditLog {
  id: string;
  collection_name: string;
  record_id: string;
  actor: string;
  action: string;
  changes: string; // JSON — changes JSON includes a .via field of type AuditVia
  created: string;
  expand?: { actor?: PBUser };
}

export type MaintenanceType =
  | "calibration"
  | "inspection"
  | "service"
  | "replacement"
  | "certification"
  | "other";

export interface KitMaintenanceSchedule {
  id: string;
  kit?: string;
  component?: string;
  type: MaintenanceType;
  description: string;
  interval_days: number;
  last_done_at: string;       // PB date "YYYY-MM-DD ..." or empty
  next_due_at: string;
  is_active: boolean;
  notes: string;
  created: string;
  updated: string;
  expand?: { kit?: Kit; component?: Component };
}

export interface MaintenanceRecord {
  id: string;
  schedule: string;
  performed_at: string;
  performed_by: string;
  notes: string;
  certificate: string;       // filename
  next_due_snapshot: string;
  created: string;
  expand?: { schedule?: KitMaintenanceSchedule; performed_by?: PBUser };
}

export interface OnCallShift {
  id: string;
  user: string;
  start_at: string;
  end_at: string;
  notes: string;
  created_by: string;
  created: string;
  updated: string;
  expand?: { user?: PBUser; created_by?: PBUser };
}

export interface ComponentTransaction {
  id: string;
  component: string;
  from_kit: string;
  from_entity: string;
  to_kit: string;
  to_entity: string;
  quantity: number;
  timestamp: string;
  notes: string;
  created_by: string;
  expand?: {
    component?: Component;
    from_kit?: Kit;
    from_entity?: Entity;
    to_kit?: Kit;
    to_entity?: Entity;
    created_by?: PBUser;
  };
}
