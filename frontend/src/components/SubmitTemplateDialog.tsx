import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { toast } from "./ui/use-toast";
import { submitTemplate } from "../services/whatsapp";
import type { SubmitTemplateInput } from "../services/whatsapp";

const CATEGORIES = ["UTILITY", "MARKETING", "AUTHENTICATION"] as const;
type Category = typeof CATEGORIES[number];

const LANGUAGES = [
  { code: "en_US", label: "English (US)" },
  { code: "en_GB", label: "English (UK)" },
  { code: "he", label: "Hebrew" },
  { code: "ar", label: "Arabic" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "pt_BR", label: "Portuguese (Brazil)" },
  { code: "ru", label: "Russian" },
] as const;

interface SubmitTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted?: () => void;
}

export function SubmitTemplateDialog({
  open,
  onOpenChange,
  onSubmitted,
}: SubmitTemplateDialogProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("UTILITY");
  const [language, setLanguage] = useState("en_US");
  const [bodyText, setBodyText] = useState("");
  const [exampleValues, setExampleValues] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Validate name: lowercase letters, digits, underscores only
  const nameValid = /^[a-z0-9_]+$/.test(name);
  const nameError = name.length > 0 && !nameValid;

  // Extract variable count from body text {{1}}, {{2}}, etc.
  const variableCount = (bodyText.match(/\{\{\d+\}\}/g) ?? []).length;

  function buildComponents(): SubmitTemplateInput["components"] {
    const components: SubmitTemplateInput["components"] = [];

    if (!bodyText.trim()) return components;

    const bodyComp: SubmitTemplateInput["components"][number] = {
      type: "BODY",
      text: bodyText.trim(),
    };

    if (variableCount > 0 && exampleValues.trim()) {
      const examples = exampleValues
        .split("\n")
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
        .slice(0, variableCount);
      if (examples.length > 0) {
        bodyComp.example = { body_text: [examples] };
      }
    }

    components.push(bodyComp);
    return components;
  }

  function isValid() {
    return name.length > 0 && nameValid && bodyText.trim().length > 0;
  }

  async function handleSubmit() {
    if (!isValid()) return;

    setSubmitting(true);
    try {
      const input: SubmitTemplateInput = {
        name,
        category,
        language,
        components: buildComponents(),
      };
      const result = await submitTemplate(input);

      if (result.success) {
        toast({
          title: "Template submitted",
          description:
            "Template submitted to Meta. Approval takes 24-48 hours. Refresh this page to check status.",
          variant: "success",
        });
        onOpenChange(false);
        onSubmitted?.();
        // Reset form
        setName("");
        setCategory("UTILITY");
        setLanguage("en_US");
        setBodyText("");
        setExampleValues("");
      } else {
        const isPermission = result.isPermissionError;
        toast({
          title: isPermission ? "Permission error" : "Submission failed",
          description: isPermission
            ? "Test apps can't submit templates — use Meta Business Manager UI instead."
            : (result.error ?? "Unknown error from Meta"),
          variant: "destructive",
        });
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) {
        toast({
          title: "Submission error",
          description: err?.message ?? "Unknown error",
          variant: "destructive",
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Submit new template</DialogTitle>
          <DialogDescription>
            Templates must be approved by Meta before use (24-48h). Test apps may not support submission — use Meta Business Manager UI as fallback.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="tmpl-name">Template name</Label>
            <Input
              id="tmpl-name"
              placeholder="my_template_name"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              className={nameError ? "border-red-400 focus-visible:ring-red-400" : ""}
            />
            {nameError && (
              <p className="text-xs text-red-600">
                Lowercase letters, digits, and underscores only.
              </p>
            )}
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Language */}
          <div className="space-y-1.5">
            <Label>Language</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Body text */}
          <div className="space-y-1.5">
            <Label htmlFor="tmpl-body">Body text</Label>
            <Textarea
              id="tmpl-body"
              placeholder={"Hello {{1}}, your kit {{2}} is ready for pickup."}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={4}
            />
            {variableCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {variableCount} variable{variableCount !== 1 ? "s" : ""} detected (
                {Array.from({ length: variableCount }, (_, i) => `{{${i + 1}}}`).join(", ")})
              </p>
            )}
          </div>

          {/* Example values per variable */}
          {variableCount > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="tmpl-examples">Example values (one per line)</Label>
              <Textarea
                id="tmpl-examples"
                placeholder={Array.from(
                  { length: variableCount },
                  (_, i) => `Example ${i + 1}`
                ).join("\n")}
                value={exampleValues}
                onChange={(e) => setExampleValues(e.target.value)}
                rows={Math.min(variableCount + 1, 5)}
              />
              <p className="text-xs text-muted-foreground">
                Required by Meta when template has variables.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!isValid() || submitting}>
              {submitting ? "Submitting..." : "Submit to Meta"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
