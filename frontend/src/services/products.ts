import { pb } from "../lib/pocketbase";
import type { Component, Product } from "../types";

export async function listProducts(opts?: { includeInactive?: boolean }): Promise<Product[]> {
  // PB SDK serializes `filter: undefined` as the string "undefined" in the URL,
  // which PB rejects. Only set the filter key when we actually have a filter.
  const params: { sort: string; requestKey: string; filter?: string } = {
    sort: "name",
    // Distinct requestKey per filter state — avoids auto-cancel collisions when
    // the user rapidly toggles "show inactive".
    requestKey: opts?.includeInactive ? "list-products-all" : "list-products-active",
  };
  if (!opts?.includeInactive) params.filter = "is_active = true";
  return pb.collection("products").getFullList<Product>(params);
}

export async function getProduct(id: string): Promise<Product> {
  return pb.collection("products").getOne<Product>(id, {
    requestKey: `get-product-${id}`,
  });
}

export async function createProduct(data: Partial<Product>): Promise<Product> {
  // Always send is_active explicitly. The PB hook can't distinguish "field
  // absent" from "field=false", so the service layer owns the default.
  return pb.collection("products").create<Product>({ is_active: true, ...data });
}

export async function updateProduct(id: string, data: Partial<Product>): Promise<Product> {
  return pb.collection("products").update<Product>(id, data);
}

export async function softDeleteProduct(id: string): Promise<Product> {
  return pb.collection("products").update<Product>(id, { is_active: false });
}

export async function restoreProduct(id: string): Promise<Product> {
  return pb.collection("products").update<Product>(id, { is_active: true });
}

export async function countComponentsForProduct(productId: string): Promise<number> {
  const result = await pb.collection("components").getList<Component>(1, 1, {
    filter: pb.filter("product = {:productId} && is_active = true", { productId }),
    requestKey: `count-components-for-product-${productId}`,
  });
  return result.totalItems;
}

export async function getComponentCountsByProduct(): Promise<Record<string, number>> {
  const comps = await pb.collection("components").getFullList<Component>({
    filter: "is_active = true && product != ''",
    fields: "product",
    requestKey: "components-by-product",
  });
  const map: Record<string, number> = {};
  for (const c of comps) {
    if (c.product) map[c.product] = (map[c.product] || 0) + 1;
  }
  return map;
}

export async function listComponentsForProduct(productId: string): Promise<Component[]> {
  return pb.collection("components").getFullList<Component>({
    filter: pb.filter("product = {:productId}", { productId }),
    sort: "serial,type",
    requestKey: `list-components-for-product-${productId}`,
  });
}
