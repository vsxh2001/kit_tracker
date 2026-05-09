import * as React from "react";
import type { ToastProps } from "./toast";

type ToastVariant = NonNullable<ToastProps["variant"]>;

export interface ToastItem {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
  open: boolean;
}

interface ToastStore {
  toasts: ToastItem[];
  listeners: Set<(toasts: ToastItem[]) => void>;
}

const store: ToastStore = {
  toasts: [],
  listeners: new Set(),
};

function emit() {
  for (const l of store.listeners) l(store.toasts);
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

export interface ToastInput {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
}

export function toast(input: ToastInput) {
  const id = genId();
  const item: ToastItem = { id, open: true, ...input };
  store.toasts = [item, ...store.toasts].slice(0, 5);
  emit();
  return id;
}

export function dismissToast(id: string) {
  store.toasts = store.toasts.map((t) => (t.id === id ? { ...t, open: false } : t));
  emit();
  setTimeout(() => {
    store.toasts = store.toasts.filter((t) => t.id !== id);
    emit();
  }, 300);
}

export function useToast() {
  const [toasts, setToasts] = React.useState<ToastItem[]>(store.toasts);
  React.useEffect(() => {
    store.listeners.add(setToasts);
    return () => {
      store.listeners.delete(setToasts);
    };
  }, []);
  return { toasts, toast, dismiss: dismissToast };
}
