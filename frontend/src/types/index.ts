export type RequestStatus =
  | "open"
  | "approved"
  | "rejected"
  | "fulfilled"
  | "cancelled";

export type UserRole = "admin" | "user" | "viewer";

export interface Kit {
  id: string;
  serial: string;
  notes?: string;
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
