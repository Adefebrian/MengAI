// A real <table> on the Carbon DataTable anatomy in JAL Core: header row in
// meta type, tabular mono for numbers, one hairline between rows, product
// density from 1024px. Below 768px every row stacks into label and value
// pairs (each cell carries its column label), so a wide table never
// scrolls sideways on a phone.
import type { ReactNode } from "react";

export interface DataTableColumn<Row> {
  key: string;
  label: string;
  /** right aligned tabular figures */
  numeric?: boolean;
  cell: (row: Row) => ReactNode;
}

export interface DataTableProps<Row> {
  caption: string;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** the caption stays for assistive tech only */
  hideCaption?: boolean;
  empty?: ReactNode;
}

export function DataTable<Row>({ caption, columns, rows, rowKey, hideCaption = true, empty }: DataTableProps<Row>) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="p-table-wrap">
      <table className="p-table" aria-label={hideCaption ? caption : undefined}>
        {hideCaption ? null : <caption className="p-table-caption">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" data-numeric={c.numeric ? "" : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c, i) =>
                i === 0 ? (
                  <th key={c.key} scope="row" data-label={c.label} data-numeric={c.numeric ? "" : undefined}>
                    {c.cell(row)}
                  </th>
                ) : (
                  <td key={c.key} data-label={c.label} data-numeric={c.numeric ? "" : undefined}>
                    {c.cell(row)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
