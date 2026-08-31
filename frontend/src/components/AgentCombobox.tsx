import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AgentStat } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function formatAgentLabel(a: AgentStat): string {
  const companyStr = a.company ? ` · ${a.company}` : "";
  return `${a.name}${companyStr} (${a.today} today / ${a.total} total)`;
}

export default function AgentCombobox({
  agents,
  value,
  onChange,
  totalSurveys,
}: {
  agents: AgentStat[];
  value: string;
  onChange: (userId: string) => void;
  totalSurveys: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedAgent = agents.find((a) => a.user_id === value);

  const filtered = search.trim()
    ? agents.filter((a) => {
        const q = search.toLowerCase().trim();
        const nameMatch = a.name.toLowerCase().includes(q);
        const companyMatch = a.company
          ? a.company.toLowerCase().includes(q)
          : false;
        return nameMatch || companyMatch;
      })
    : agents;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    } else {
      setSearch("");
    }
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-full sm:w-80">
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className="w-full justify-between text-left font-normal shadow-xs"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="truncate">
          {selectedAgent
            ? formatAgentLabel(selectedAgent)
            : `All agents (${totalSurveys})`}
        </span>
        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
      </Button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md outline-hidden animate-in fade-in-0 zoom-in-95">
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 size-4 shrink-0 opacity-50" />
            <Input
              ref={inputRef}
              placeholder="Search by agent or company name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 border-0 px-0 shadow-none focus-visible:ring-0"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-60 overflow-y-auto p-1 text-sm">
            <button
              type="button"
              className={cn(
                "relative flex w-full cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground",
                !value && "bg-accent/50 font-medium",
              )}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              <span>All agents ({totalSurveys})</span>
              {!value && <Check className="size-4 text-primary" />}
            </button>

            {filtered.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                No agent or company found.
              </div>
            ) : (
              filtered.map((a) => {
                const isSelected = value === a.user_id;
                return (
                  <button
                    key={a.user_id}
                    type="button"
                    className={cn(
                      "relative flex w-full cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground",
                      isSelected && "bg-accent/50 font-medium",
                    )}
                    onClick={() => {
                      onChange(a.user_id);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate pr-2">{formatAgentLabel(a)}</span>
                    {isSelected && (
                      <Check className="size-4 shrink-0 text-primary" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
