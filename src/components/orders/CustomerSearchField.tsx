import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { customerSearchInputProps } from "@/lib/phoneInputDirection";

export type CustomerSearchHit = {
  id: string;
  name: string;
  phone: string;
  phone2?: string | null;
};

export function CustomerSearchField<T extends CustomerSearchHit>({
  value,
  onChange,
  customers,
  searching,
  onSelect,
}: {
  value: string;
  onChange: (value: string) => void;
  customers: T[];
  searching: boolean;
  onSelect: (customer: T) => void;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = value.trim();
  const show = open && query.length > 0 && (searching || customers.length > 0);
  const resultKey = customers.map((customer) => customer.id).join("\0");

  useEffect(() => {
    if (query) setOpen(true);
  }, [query]);

  useEffect(() => {
    setActive(0);
  }, [value, resultKey]);

  useEffect(() => {
    if (!show) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [show]);

  const choose = (customer: T) => {
    onSelect(customer);
    setOpen(false);
  };

  const searchProps = customerSearchInputProps(value);

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute right-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder="بحث عن عميل..."
        aria-label="بحث عن عميل"
        aria-expanded={show}
        aria-controls={listId}
        aria-activedescendant={show && customers[active] ? `${listId}-${customers[active].id}` : undefined}
        role="combobox"
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          if (!show || customers.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(customers.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const customer = customers[active];
            if (customer) choose(customer);
          }
        }}
        {...searchProps}
        className={`pr-10 ${searchProps.className}`}
      />
      {show && (
        <div
          id={listId}
          role="listbox"
          aria-label="نتائج العملاء"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-lg border bg-popover shadow-lg"
        >
          {searching && customers.length === 0 && (
            <p className="px-3 py-3 text-xs text-muted-foreground">جاري البحث عن العملاء...</p>
          )}
          {customers.map((customer, index) => (
            <button
              key={customer.id}
              id={`${listId}-${customer.id}`}
              type="button"
              role="option"
              aria-selected={index === active}
              className={`flex min-h-12 w-full flex-col items-stretch justify-center border-b px-3 py-2 text-right last:border-b-0 ${index === active ? "bg-accent/40" : "hover:bg-muted/60"}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(customer)}
            >
              <span className="font-medium">{customer.name}</span>
              <span className="text-sm text-muted-foreground" dir="ltr" style={{ unicodeBidi: "isolate" }}>
                {customer.phone}
                {customer.phone2 && customer.phone2 !== customer.phone ? ` / ${customer.phone2}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
