export type RequestStatus =
  | "open"
  | "approved"
  | "rejected"
  | "fulfilled"
  | "cancelled";

export type UserRole = "admin" | "technician" | "user" | "viewer";

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

export interface Entity {
  id: string;
  name: string;
  description?: string;
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

export interface PBUser {
  id: string;
  email: string;
  name?: string;
  role: UserRole;
  entity?: string;
  created: string;
  updated: string;
}

export interface Component {
  id: string;
  serial: string;
  type: string;
  notes: string;
  is_active: boolean;
  is_bulk: boolean;
  quantity: number;
  created: string;
  updated: string;
}

export interface AuditLog {
  id: string;
  collection_name: "kits" | "entities" | "users";
  record_id: string;
  actor: string;
  action: "create" | "update" | "delete";
  changes: string; // JSON
  created: string;
  expand?: { actor?: PBUser };
}

export interface KitMaintenanceSchedule {
  id: string;
  kit: string;
  type: string;
  description: string;
  interval_days: number;
  last_done_at: string;       // PB date "YYYY-MM-DD ..." or empty
  next_due_at: string;
  is_active: boolean;
  notes: string;
  created: string;
  updated: string;
  expand?: { kit?: Kit };
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
