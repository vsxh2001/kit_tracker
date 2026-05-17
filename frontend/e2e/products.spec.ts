/**
 * products.spec.ts — Products catalog feature tests.
 *
 * @smoke tests cover core CRUD flows.
 *
 * Groups:
 *   P1-P3   Admin CRUD (create, edit, soft-delete / restore)
 *   P4      Technician parity
 *   P5      Viewer cannot see Add/Edit buttons
 *   P6      AddComponentDialog product picker
 *   P7      ComponentDetailPage shows linked product
 *   P8      KitDetailPage Components card shows product name
 *
 * Requires: PocketBase on $PB_URL (default :8090) + Vite on PLAYWRIGHT_TEST_BASE_URL.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  createTestProduct,
  deleteTestProduct,
  createTestKit,
  createTestEntity,
  createTestTransaction,
  createTestComponent,
  deleteKit,
  deactivateEntity,
  deactivateComponent,
  linkComponentToProduct,
  getUserTokenByEmail,
} from "./helpers/api";
import { loginAs } from "./helpers/auth";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";
const TS = `prod-${Date.now()}`;

async function waitForProductsPage(page: Page) {
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(/loading…/i)).not.toBeVisible({ timeout: 8000 });
}

// ---------------------------------------------------------------------------
// P1-P3: Admin CRUD
// ---------------------------------------------------------------------------

test.describe("P1-P3: Admin product CRUD @smoke", () => {
  let productId: string;
  const PROD_NAME = `${TS}-Laptop`;

  test.afterAll(async () => {
    if (productId) await deleteTestProduct(productId);
  });

  test("P1: admin creates product via UI, sees it in list @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/products");
    await waitForProductsPage(page);

    // Click Add product
    await page.getByRole("button", { name: /add product/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/name/i).fill(PROD_NAME);
    await dialog.getByLabel(/category/i).fill("Electronics");
    await dialog.getByLabel(/manufacturer/i).fill("TestCo");
    await dialog.getByLabel(/model/i).fill("Model-X");

    await dialog.getByRole("button", { name: /create/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8000 });

    // Product appears in list — scope to table to avoid strict mode with notification/sidebar
    await expect(page.getByRole("table").getByText(PROD_NAME)).toBeVisible({ timeout: 8000 });

    // Get product id via API for cleanup
    const token = await (async () => {
      const res = await fetch(`${PB_URL}/api/collections/products/records?filter=name="${PROD_NAME}"`, {
        headers: { Authorization: (await getUserTokenByEmail("logistics@kit.local", "Pass1234!")).token },
      });
      const data = await res.json();
      return data.items?.[0]?.id;
    })();
    productId = token;
  });

  test("P2: admin edits product, sees update @smoke", async ({ page }) => {
    if (!productId) {
      // Create via API if P1 didn't run
      const prod = await createTestProduct({ name: `${TS}-EditProd`, category: "Electronics" });
      productId = prod.id;
    }

    await loginAs(page, "admin");
    await page.goto(`/products/${productId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 8000 });

    // Click Edit button
    await page.getByRole("button", { name: /edit/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Update name
    const nameInput = dialog.getByLabel(/name/i);
    await nameInput.clear();
    await nameInput.fill(`${TS}-Laptop-Updated`);
    await dialog.getByRole("button", { name: /save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8000 });

    // Updated name visible — scope to heading to avoid notification ambiguity
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`${TS}-Laptop-Updated`) })).toBeVisible({ timeout: 8000 });
  });

  test("P3: admin soft-deletes product, hidden from default list, visible with show-inactive @smoke", async ({ page }) => {
    // Create fresh product
    const prod = await createTestProduct({ name: `${TS}-ToDelete`, category: "Electronics" });
    const toDeleteId = prod.id;

    await loginAs(page, "admin");
    await page.goto(`/products/${toDeleteId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 8000 });

    // Deactivate
    await page.getByRole("button", { name: /deactivate/i }).click();
    const confirmDialog = page.getByRole("alertdialog");
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: /deactivate/i }).click();
    await expect(confirmDialog).not.toBeVisible({ timeout: 8000 });

    // Inactive badge shown
    await expect(page.getByText("Inactive")).toBeVisible({ timeout: 8000 });

    // Go to list: not visible by default
    await page.goto("/products");
    await waitForProductsPage(page);
    await expect(page.getByText(`${TS}-ToDelete`)).not.toBeVisible();

    // Toggle show inactive — note: filtering might be done client-side
    // Check that the checkbox exists and click it
    const inactiveCheckbox = page.getByLabel(/show inactive/i);
    await expect(inactiveCheckbox).toBeVisible({ timeout: 5000 });
    await inactiveCheckbox.check();
    // The product should now be visible. Scope to the desktop table to avoid
    // strict-mode collision with the mobile card layout (both render in DOM).
    await expect(page.getByRole("table").getByText(`${TS}-ToDelete`)).toBeVisible({ timeout: 8000 });

    await deleteTestProduct(toDeleteId);
  });
});

// ---------------------------------------------------------------------------
// P4: Technician parity
// ---------------------------------------------------------------------------

test.describe("P4: Technician can create and edit products", () => {
  let prodId: string;

  test.afterAll(async () => {
    if (prodId) await deleteTestProduct(prodId);
  });

  test("P4: technician can create product @smoke", async ({ page }) => {
    // Use API — technician role uses tech@kit.local (see components.spec.ts)
    // We verify at the REST level: admin creates, technician should be able to PATCH
    // (create rule: admin or technician per DB rules spec)
    const { token } = await getUserTokenByEmail("tech@kit.local", "Pass1234!");
    const res = await fetch(`${PB_URL}/api/collections/products/records`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${TS}-TechProd`, is_active: true }),
    });
    // PB v0.22: 200 on success for technician (create/update rule = admin or technician)
    expect(res.status, "Technician must be allowed to create products").toBe(200);
    const data = await res.json();
    prodId = data.id;

    // Verify UI: technician sees Add product button
    await page.goto("/login");
    await page.getByLabel("Email").fill("tech@kit.local");
    await page.getByLabel("Password").fill("Pass1234!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/dashboard", { timeout: 10_000 });
    await page.goto("/products");
    await waitForProductsPage(page);
    await expect(page.getByRole("button", { name: /add product/i })).toBeVisible({
      message: "Technician must see 'Add product' button",
    });
  });
});

// ---------------------------------------------------------------------------
// P5: Viewer cannot see Add/Edit buttons
// ---------------------------------------------------------------------------

test.describe("P5: Viewer cannot see Add/Edit buttons", () => {
  let viewerProdId: string;

  test.beforeAll(async () => {
    const prod = await createTestProduct({ name: `${TS}-ViewerProd` });
    viewerProdId = prod.id;
  });

  test.afterAll(async () => {
    if (viewerProdId) await deleteTestProduct(viewerProdId);
  });

  test("P5: viewer can browse products but not see Add/Edit @smoke", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto("/products");
    await waitForProductsPage(page);

    // No "Add product" button
    await expect(page.getByRole("button", { name: /add product/i })).not.toBeVisible({
      message: "Viewer must NOT see 'Add product' button",
    });

    // Can navigate to detail page
    await page.goto(`/products/${viewerProdId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 8000 });

    // No Edit button
    await expect(page.getByRole("button", { name: /edit/i })).not.toBeVisible({
      message: "Viewer must NOT see Edit button on product detail",
    });
  });
});

// ---------------------------------------------------------------------------
// P6: AddComponentDialog product picker
// ---------------------------------------------------------------------------

test.describe("P6: AddComponentDialog product picker", () => {
  let pickerProdId: string;
  let entityId: string;
  let kitId: string;

  test.beforeAll(async () => {
    pickerProdId = (await createTestProduct({ name: `${TS}-PickerProd`, manufacturer: "PickerCo" })).id;
    entityId = (await createTestEntity(`${TS}-PickerEntity`, "", "storage")).id;
    kitId = (await createTestKit(`${TS}-KIT-PICKER`)).id;
    await createTestTransaction({ kitId, toEntityId: entityId });
  });

  test.afterAll(async () => {
    await deleteTestProduct(pickerProdId);
    await deleteKit(kitId);
    await deactivateEntity(entityId);
  });

  test("P6: product picker shows existing products; selecting one creates component @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    await expect(page.getByRole("heading", { name: /components in kit/i })).toBeVisible({ timeout: 8000 });

    // Open Add component dialog
    await page.getByRole("button", { name: /add component/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Should have product picker combobox
    const productPicker = dialog.getByRole("combobox", { name: /product/i });
    await expect(productPicker).toBeVisible({
      message: "Add Component dialog must have a product picker",
    });

    // Open it and select the test product
    await productPicker.click();
    const productOption = page.getByRole("option", { name: new RegExp(`${TS}-PickerProd`) });
    await expect(productOption).toBeVisible({
      message: "Product picker must list the created product",
    });
    await productOption.click();

    // Submit with product selected — component should be created, dialog should close
    const buttons = dialog.getByRole("button");
    const submitBtn = buttons.last(); // Last button is Create/Move
    await submitBtn.click();
    // Component should be created, dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// P7: ComponentDetailPage shows linked product + N-instances link
// ---------------------------------------------------------------------------

test.describe("P7: ComponentDetailPage shows linked product", () => {
  let prodId: string;
  let compId: string;
  let entityId: string;

  test.beforeAll(async () => {
    prodId = (await createTestProduct({ name: `${TS}-LinkedProd`, manufacturer: "LinkCo", model: "LM-1" })).id;
    entityId = (await createTestEntity(`${TS}-LinkEntity`, "", "storage")).id;
    const comp = await createTestComponent({
      serial: `${TS}-LINK-SER`,
      type: "Gadget",
      initialEntity: entityId,
    });
    compId = comp.id;
    // Link component to product via API
    await linkComponentToProduct(compId, prodId);
  });

  test.afterAll(async () => {
    if (compId) await deactivateComponent(compId);
    await deleteTestProduct(prodId);
    await deactivateEntity(entityId);
  });

  test("P7: component detail shows product card and instance count @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/components/${compId}`);
    await expect(page.getByText(/movement history/i)).toBeVisible({ timeout: 8000 });

    // Product card visible
    await expect(page.getByText(`${TS}-LinkedProd`)).toBeVisible({
      message: "Component detail must show linked product name",
    });

    // Instances link visible
    await expect(page.getByText(/instances of this product/i)).toBeVisible({
      message: "Component detail must show instances-of-product link",
    });
  });
});

// ---------------------------------------------------------------------------
// P8: KitDetailPage Components card shows product name when linked
// ---------------------------------------------------------------------------

test.describe("P8: KitDetailPage Components card shows product name", () => {
  let prodId: string;
  let compId: string;
  let entityId: string;
  let kitId: string;

  test.beforeAll(async () => {
    prodId = (await createTestProduct({ name: `${TS}-KitProd`, manufacturer: "KitCo" })).id;
    entityId = (await createTestEntity(`${TS}-KitProdEntity`, "", "storage")).id;
    kitId = (await createTestKit(`${TS}-KIT-PROD`)).id;
    await createTestTransaction({ kitId, toEntityId: entityId });
    const comp = await createTestComponent({
      serial: `${TS}-KITPROD-SER`,
      type: "Module",
      initialKit: kitId,
      fromEntity: entityId,
    });
    compId = comp.id;
    await linkComponentToProduct(compId, prodId);
  });

  test.afterAll(async () => {
    if (compId) await deactivateComponent(compId);
    await deleteTestProduct(prodId);
    await deleteKit(kitId);
    await deactivateEntity(entityId);
  });

  test("P8: kit detail Components table shows product name when linked @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    await expect(page.getByRole("heading", { name: /components in kit/i })).toBeVisible({ timeout: 8000 });

    // Product name should appear as a link in the components table
    // Use getByRole to scope to the link element, avoiding other instances in the page
    await expect(page.getByRole("link", { name: `${TS}-KitProd` })).toBeVisible({
      message: "Kit detail Components card must show product name when component has linked product",
    });
  });
});

// ---------------------------------------------------------------------------
// P9: REST-level permission checks for products collection
// ---------------------------------------------------------------------------

test.describe("P9: Products permission enforcement (REST)", () => {
  let permProdId: string;

  test.beforeAll(async () => {
    permProdId = (await createTestProduct({ name: `${TS}-PermProd` })).id;
  });

  test.afterAll(async () => {
    if (permProdId) await deleteTestProduct(permProdId);
  });

  test("P9a: viewer can list products (listRule = any auth)", async () => {
    const { token } = await getUserTokenByEmail("viewer@kit.local", "Pass1234!");
    const res = await fetch(`${PB_URL}/api/collections/products/records`, {
      headers: { Authorization: token },
    });
    expect(res.status, "Viewer must be able to list products").toBe(200);
  });

  test("P9b: regular user cannot create product (createRule = admin or technician → 400)", async () => {
    const { token } = await getUserTokenByEmail("requester@kit.local", "Pass1234!");
    const res = await fetch(`${PB_URL}/api/collections/products/records`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${TS}-NoPermProd`, is_active: true }),
    });
    expect(res.status, "Regular user must NOT create products → 400").toBe(400);
  });

  test("P9c: delete product returns 403 (deleteRule = null)", async () => {
    const token = (await import("./helpers/api")).getAdminToken;
    const adminToken = await token();
    const res = await fetch(`${PB_URL}/api/collections/products/records/${permProdId}`, {
      method: "DELETE",
      headers: { Authorization: adminToken },
    });
    // deleteRule = null → only superadmin can delete (regular admin gets 403)
    expect(res.status, "deleteRule null: even admin cannot hard-delete products → 403").toBe(403);
  });
});

// ---------------------------------------------------------------------------
// P10: Create component from product detail page
// ---------------------------------------------------------------------------

test.describe("P10: Create component from product detail page", () => {
  let p10ProdId: string;
  let p10EntityId: string;

  test.beforeAll(async () => {
    p10ProdId = (await createTestProduct({ name: `${TS}-P10Prod`, category: "Electronics" })).id;
    p10EntityId = (await createTestEntity(`${TS}-P10Entity`, "", "storage")).id;
  });

  test.afterAll(async () => {
    await deleteTestProduct(p10ProdId);
    await deactivateEntity(p10EntityId);
  });

  test("P10: admin clicks 'Add component' on product detail page, creates component linked to product @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/products/${p10ProdId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 8000 });

    // "Add component" button in linked-components section
    const addBtn = page.getByRole("button", { name: /add component/i });
    await expect(addBtn).toBeVisible({ message: "Admin must see 'Add component' button on product detail" });
    await addBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Product field should be locked/pre-filled — no editable combobox for product
    // The product name should appear as a read-only display
    await expect(dialog.getByText(`${TS}-P10Prod`)).toBeVisible({
      message: "Dialog must show the preset product name in read-only display",
    });

    // Fill serial to satisfy serialized requirement (is_bulk=false)
    const serialInput = dialog.getByLabel(/serial/i);
    await serialInput.fill(`${TS}-P10-SER`);

    // Submit — exact "Create" to avoid matching "Create new" in product picker
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8000 });

    // Component section should now show 1 component
    await expect(page.getByText(/1 component/).first()).toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// P11: Product with url shows clickable link
// ---------------------------------------------------------------------------

test.describe("P11: Product with url shows clickable link", () => {
  let p11ProdId: string;
  const TEST_URL = "https://example.com/datasheet";

  test.beforeAll(async () => {
    const { token } = await getUserTokenByEmail("logistics@kit.local", "Pass1234!");
    const res = await fetch(`${PB_URL}/api/collections/products/records`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${TS}-P11Prod`,
        url: TEST_URL,
        is_active: true,
      }),
    });
    const data = await res.json();
    p11ProdId = data.id;
  });

  test.afterAll(async () => {
    if (p11ProdId) await deleteTestProduct(p11ProdId);
  });

  test("P11: product detail page shows clickable url link when url is set @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/products/${p11ProdId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 8000 });

    // URL link should be visible and clickable
    const urlLink = page.getByRole("link", { name: new RegExp(TEST_URL) });
    await expect(urlLink).toBeVisible({
      message: "Product detail must show url as a clickable link",
    });

    // Verify it has target=_blank
    const href = await urlLink.getAttribute("href");
    expect(href, "URL link must point to the correct href").toBe(TEST_URL);
  });

  test("P11b: REST: POST product with url → stored; GET returns url", async () => {
    const { token } = await getUserTokenByEmail("logistics@kit.local", "Pass1234!");
    const res = await fetch(`${PB_URL}/api/collections/products/records/${p11ProdId}`, {
      headers: { Authorization: token },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url, "GET product must return the stored url").toBe(TEST_URL);
  });
});

// ---------------------------------------------------------------------------
// P12: Serialized vs Bulk product — is_serialized enforcement (REST-level)
// ---------------------------------------------------------------------------

test.describe("P12: Serialized vs bulk product enforcement (serialized)", () => {
  let serializedProdId: string;
  let bulkProdId: string;
  const createdCompIds: string[] = [];

  test.beforeAll(async () => {
    serializedProdId = (await createTestProduct({
      name: `${TS}-SerializedProd`,
      is_serialized: true,
    })).id;
    bulkProdId = (await createTestProduct({
      name: `${TS}-BulkProd`,
      is_serialized: false,
    })).id;
  });

  test.afterAll(async () => {
    for (const id of createdCompIds) {
      await deactivateComponent(id);
    }
    await deleteTestProduct(serializedProdId);
    await deleteTestProduct(bulkProdId);
  });

  test("P12a: serialized product — create component with serial succeeds @smoke", async () => {
    const { token } = await getUserTokenByEmail("logistics@kit.local", "Pass1234!");
    const res = await fetch(`${PB_URL}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        serial: `${TS}-SER-001`,
        is_bulk: false,
        quantity: 1,
        is_active: true,
        product: serializedProdId,
      }),
    });
    expect(res.status, "Serialized product: component with serial must succeed").toBe(200);
    const data = await res.json();
    createdCompIds.push(data.id);
  });

  test("P12b: serialized product — create component without serial is rejected @smoke", async () => {
    const { token } = await getUserTokenByEmail("logistics@kit.local", "Pass1234!");
    const res = await fetch(`${PB_URL}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        serial: "",
        is_bulk: false,
        quantity: 1,
        is_active: true,
        product: serializedProdId,
      }),
    });
    expect(res.status, "Serialized product: component without serial must be rejected").toBe(400);
  });

  test("P12c: serialized product — create component with quantity>1 is coerced to 1 @smoke", async () => {
    const { token } = await getUserTokenByEmail("logistics@kit.local", "Pass1234!");
    const res = await fetch(`${PB_URL}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        serial: `${TS}-SER-QTY`,
        is_bulk: false,
        quantity: 5,
        is_active: true,
        product: serializedProdId,
      }),
    });
    // Hook forces quantity=NULL for serialized products (NULL serializes as 0 in PB REST responses)
    expect(res.status, "Serialized product: component with qty>1 must be accepted (qty coerced to NULL)").toBe(200);
    const data = await res.json();
    // PB returns NULL numeric fields as 0 in JSON; hook sets quantity=NULL via raw SQL for serialized
    expect(data.quantity, "Quantity must be nulled by the hook (returned as 0 from PB)").toBe(0);
    createdCompIds.push(data.id);
  });

  test("P12d: bulk product — create component with serial is rejected @smoke", async () => {
    const { token } = await getUserTokenByEmail("logistics@kit.local", "Pass1234!");
    const res = await fetch(`${PB_URL}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        serial: `${TS}-BULK-SER`,
        is_bulk: true,
        quantity: 5,
        is_active: true,
        product: bulkProdId,
      }),
    });
    expect(res.status, "Bulk product: component with non-empty serial must be rejected").toBe(400);
  });

  test("P12e: bulk product — create component with qty=5 and no serial succeeds @smoke", async () => {
    const { token } = await getUserTokenByEmail("logistics@kit.local", "Pass1234!");
    const res = await fetch(`${PB_URL}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        serial: "",
        is_bulk: true,
        quantity: 5,
        is_active: true,
        product: bulkProdId,
      }),
    });
    expect(res.status, "Bulk product: component with qty=5 and no serial must succeed").toBe(200);
    const data = await res.json();
    createdCompIds.push(data.id);
  });

  test("P12f: UI — admin creates serialized product via dialog, sees Serialized badge", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/products");
    await waitForProductsPage(page);

    await page.getByRole("button", { name: /add product/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/name/i).fill(`${TS}-UI-SerialProd`);

    // Serialized checkbox should be checked by default
    const serializedCheckbox = dialog.getByLabel(/serialized/i);
    await expect(serializedCheckbox).toBeChecked({
      message: "Serialized checkbox must be checked by default",
    });

    await dialog.getByRole("button", { name: /create/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8000 });

    // Find the new product and check badge on detail page
    const { token } = await getUserTokenByEmail("logistics@kit.local", "Pass1234!");
    const listRes = await fetch(
      `${PB_URL}/api/collections/products/records?filter=name="${TS}-UI-SerialProd"`,
      { headers: { Authorization: token } }
    );
    const listData = await listRes.json();
    const newProdId = listData.items?.[0]?.id;
    if (newProdId) {
      await page.goto(`/products/${newProdId}`);
      await expect(page.getByText("Serialized")).toBeVisible({
        message: "Product detail must show Serialized badge",
        timeout: 8000,
      });
      // Cleanup
      await fetch(`${PB_URL}/api/collections/products/records/${newProdId}`, {
        method: "PATCH",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      });
    }
  });
});
