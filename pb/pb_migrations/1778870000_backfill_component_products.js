/// <reference path="../pb_data/types.d.ts" />
// Migration A: backfill component products.
//
// 1. Collect all distinct non-empty components.type values.
// 2. For each unique type T: create a product named "Legacy: <T>" with category=T.
// 3. Create a fallback "Legacy / Unknown" product for components with empty type.
// 4. Link each component with empty product to the appropriate legacy product.
// 5. Post-condition check: no components remain with empty product.

migrate((db) => {
  const dao = new Dao(db);

  // Collect distinct non-empty type values from components with no product
  const orphanComponents = dao.findRecordsByFilter(
    "components",
    "product = ''",
    "",
    0,
    0
  );

  if (orphanComponents.length === 0) {
    console.log("[backfill_component_products] No orphan components found — no backfill needed");
    return null;
  }

  console.log("[backfill_component_products] Orphan components found: " + orphanComponents.length);

  // Collect distinct type values
  const typeSet = {};
  for (let i = 0; i < orphanComponents.length; i++) {
    const t = orphanComponents[i].getString("type");
    if (t && t.trim() !== "") {
      typeSet[t.trim()] = true;
    }
  }
  const distinctTypes = Object.keys(typeSet);

  // Create fallback "Legacy / Unknown" product
  const productsCol = dao.findCollectionByNameOrId("products");
  const unknownProduct = new Record(productsCol, {
    name: "Legacy / Unknown",
    category: "",
    manufacturer: "",
    model: "",
    description: "Auto-created during migration A for components with no type or product.",
    specs: "{}",
    is_active: true,
  });
  dao.saveRecord(unknownProduct);
  console.log("[backfill_component_products] Created fallback product: Legacy / Unknown (id=" + unknownProduct.id + ")");

  // Create one legacy product per distinct type
  const typeToProductId = {};
  for (let i = 0; i < distinctTypes.length; i++) {
    const t = distinctTypes[i];
    const legacyProd = new Record(productsCol, {
      name: "Legacy: " + t,
      category: t,
      manufacturer: "",
      model: "",
      description: "Auto-created during migration A for legacy component type '" + t + "'.",
      specs: "{}",
      is_active: true,
    });
    dao.saveRecord(legacyProd);
    typeToProductId[t] = legacyProd.id;
    console.log("[backfill_component_products] Created legacy product for type '" + t + "' (id=" + legacyProd.id + ")");
  }

  // Link each orphan component to the appropriate product
  for (let i = 0; i < orphanComponents.length; i++) {
    const comp = orphanComponents[i];
    const t = comp.getString("type").trim();
    const productId = t && typeToProductId[t] ? typeToProductId[t] : unknownProduct.id;
    comp.set("product", productId);
    dao.saveRecord(comp);
  }

  // Post-condition verification
  const remaining = dao.findRecordsByFilter("components", "product = ''", "", 0, 0);
  if (remaining.length > 0) {
    throw new Error(
      "[backfill_component_products] FAILED: " + remaining.length + " component(s) still have empty product after backfill"
    );
  }

  console.log("[backfill_component_products] Done. Linked " + orphanComponents.length + " components. Created " + (distinctTypes.length + 1) + " legacy products.");

  return null;
}, (db) => {
  // Down: intentional no-op — cannot safely un-link products without knowing original state
  console.log("[backfill_component_products] down: no-op");
});
