import type { ReactNode } from 'react';
import { cn } from './cn';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell renderer. Receives the row and its index. */
  render: (row: T, index: number) => ReactNode;
  className?: string;
  headerClassName?: string;
  width?: string;
  align?: 'left' | 'right' | 'center';
}

interface TableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  /** Rendered in place of the body when there are no rows. */
  empty?: ReactNode;
  className?: string;
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

/** Dense clinical table: 36px rows, 1px lines, tabular numerals available per-column. */
export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  className,
}: TableProps<T>) {
  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-body">
        <thead>
          <tr className="border-b border-line">
            {columns.map((col) => (
              <th
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
                className={cn(
                  'h-8 px-3 text-section font-semibold uppercase tracking-wide text-muted',
                  alignClass[col.align ?? 'left'],
                  col.headerClassName,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="p-0">
                {empty ?? (
                  <div className="px-3 py-8 text-center text-meta text-muted">No records.</div>
                )}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-line last:border-0',
                  onRowClick && 'cursor-pointer hover:bg-page',
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'h-9 px-3 align-middle text-ink',
                      alignClass[col.align ?? 'left'],
                      col.className,
                    )}
                  >
                    {col.render(row, i)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
