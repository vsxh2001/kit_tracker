import { useEffect, useState, startTransition } from "react";
import { Navigate, Link } from "react-router-dom";
import { LayoutTemplate, ChevronLeft, Plus, RefreshCw } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { toast } from "../components/ui/use-toast";
import { SubmitTemplateDialog } from "../components/SubmitTemplateDialog";
import { listTemplates } from "../services/whatsapp";
import { useAuth } from "../context/AuthContext";
import type { WhatsAppTemplate } from "../services/whatsapp";

function statusBadgeVariant(
  status: WhatsAppTemplate["status"]
): "success" | "warning" | "destructive" | "gray" | "secondary" {
  switch (status) {
    case "APPROVED":
      return "success";
    case "PENDING":
    case "IN_APPEAL":
      return "warning";
    case "REJECTED":
    case "DISABLED":
      return "destructive";
    default:
      return "gray";
  }
}

function categoryBadgeVariant(
  category: WhatsAppTemplate["category"]
): "default" | "secondary" | "purple" {
  switch (category) {
    case "MARKETING":
      return "default";
    case "AUTHENTICATION":
      return "purple";
    default:
      return "secondary";
  }
}

function getBodyPreview(components: WhatsAppTemplate["components"]): string {
  const body = components.find((c) => c.type === "BODY");
  if (!body?.text) return "";
  return body.text.length > 120 ? body.text.slice(0, 120) + "..." : body.text;
}

export function WhatsAppTemplatesPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitOpen, setSubmitOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setTemplates(await listTemplates());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) {
        console.error(err);
        toast({
          title: "Failed to load templates",
          description: err?.message ?? "Unknown error",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, []);

  if (authLoading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <Link
            to="/settings/whatsapp"
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to WhatsApp settings"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <LayoutTemplate className="h-6 w-6 text-emerald-500 shrink-0" />
          <h1 className="text-xl font-semibold tracking-tight">Message Templates</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => startTransition(() => load())}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setSubmitOpen(true)}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Submit new template
          </Button>
        </div>
      </div>

      {/* Templates table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Templates from Meta{!loading && ` (${templates.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">
              No templates found. Submit a template to Meta to get started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50/60">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Name
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Status
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Category
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Language
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Body preview
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr
                      key={t.id || t.name}
                      className="border-b last:border-0 hover:bg-slate-50/60 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-medium whitespace-nowrap">
                        {t.name}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Badge variant={statusBadgeVariant(t.status)}>{t.status}</Badge>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Badge variant={categoryBadgeVariant(t.category)}>{t.category}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs whitespace-nowrap">
                        {t.language}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
                        {getBodyPreview(t.components) || (
                          <span className="italic">No body component</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <SubmitTemplateDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        onSubmitted={() => startTransition(() => load())}
      />
    </div>
  );
}
