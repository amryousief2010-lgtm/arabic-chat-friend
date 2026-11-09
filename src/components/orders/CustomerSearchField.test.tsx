import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomerSearchField, type CustomerSearchHit } from "./CustomerSearchField";

const customers: CustomerSearchHit[] = [
  { id: "c1", name: "عميل اختبار", phone: "01077770001", phone2: "01077770002" },
  { id: "c2", name: "عميل آخر", phone: "01077770009" },
];

function Harness({
  initial = "",
  results = customers,
  searching = false,
  onSelect = vi.fn(),
}: {
  initial?: string;
  results?: CustomerSearchHit[];
  searching?: boolean;
  onSelect?: (customer: CustomerSearchHit) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <div className="flex gap-3">
        <CustomerSearchField
          value={value}
          onChange={setValue}
          customers={value.trim() ? results : []}
          searching={searching}
          onSelect={onSelect}
        />
        <button type="button">إخفاء النموذج</button>
      </div>
      <form aria-label="نموذج عميل جديد">
        <label>
          الاسم
          <input />
        </label>
      </form>
      <button type="button">خارج البحث</button>
    </div>
  );
}

describe("CustomerSearchField", () => {
  it("lists matches directly under the search box, above the new-customer form", () => {
    render(<Harness initial="عميل" />);
    const input = screen.getByLabelText("بحث عن عميل");
    const list = screen.getByRole("listbox", { name: "نتائج العملاء" });
    const form = screen.getByRole("form", { name: "نموذج عميل جديد" });
    expect(input.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(input.parentElement).toBe(list.parentElement);
    expect(screen.getByText("عميل اختبار")).toBeInTheDocument();
    expect(screen.getByText("01077770001 / 01077770002")).toBeInTheDocument();
  });

  it("selects on tap or Enter and closes", () => {
    const onSelect = vi.fn();
    render(<Harness initial="010" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("option", { name: /عميل اختبار/ }));
    expect(onSelect).toHaveBeenCalledWith(customers[0]);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("moves with the keyboard and closes on Escape or an outside tap", () => {
    const onSelect = vi.fn();
    render(<Harness initial="عميل" onSelect={onSelect} />);
    const input = screen.getByLabelText("بحث عن عميل");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(customers[1]);

    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.focus(input);
    fireEvent.pointerDown(screen.getByRole("button", { name: "خارج البحث" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
