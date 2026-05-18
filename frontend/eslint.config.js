import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        // Rule 1: forbid filter:undefined — PB SDK v0.21 serializes it as literal "undefined" string → 0 records
        {
          selector: "Property[key.name='filter'][value.type='Identifier'][value.name='undefined']",
          message: "filter:undefined sends literal 'undefined' string to PocketBase — omit the property when no filter is needed",
        },
        {
          selector: "Property[key.name='filter'][value.type='LogicalExpression'][value.operator='||'][value.right.name='undefined']",
          message: "filter:undefined sends literal 'undefined' string to PocketBase — omit the property when no filter is needed",
        },
        // Rule 2: forbid pb.baseUrl in template literals — VITE_PB_URL='/' in prod → '//api/...' → DNS fail
        {
          selector: "TemplateLiteral > MemberExpression[object.name='pb'][property.name='baseUrl']",
          message: "Don't use pb.baseUrl directly in URL template — VITE_PB_URL='/' in prod produces '//api/...'. Use baseUrl() helper from services/admin.ts or similar that strips trailing slash.",
        },
        // Rule 3: forbid <SelectItem value=""> — Radix Select throws on empty-string value
        {
          selector: "JSXElement[openingElement.name.name='SelectItem'] JSXAttribute[name.name='value'][value.value='']",
          message: "Radix <SelectItem> forbids empty-string value. Use a sentinel (e.g. value='all') and check for it in your filter logic.",
        },
        // Rule 4: forbid arbitrary text size brackets — pin to Tailwind scale
        {
          selector: "JSXAttribute[name.name='className'] Literal[value=/text-\\[(?!none\\]|inherit)/]",
          message: "Avoid arbitrary text size brackets. Use Tailwind's scale: text-xs (12px), text-sm (14px), text-base (16px), text-lg (18px), text-xl (20px), text-2xl (24px). If you genuinely need a custom size, propose it as a scale extension first.",
        },
      ],
    },
  },
])
