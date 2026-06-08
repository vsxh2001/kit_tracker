import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/button";
import { RetiredBadge } from "../RetiredBadge";
import type { Kit } from "../../types";

interface KitDetailHeaderProps {
  kit: Kit;
}

export function KitDetailHeader({ kit }: KitDetailHeaderProps) {
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => navigate("/kits")}>
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div className="flex items-center gap-2.5">
        <h1 className="text-2xl font-semibold font-mono tracking-wide">{kit.serial}</h1>
        <RetiredBadge isActive={kit.is_active} size="md" />
      </div>
    </div>
  );
}
