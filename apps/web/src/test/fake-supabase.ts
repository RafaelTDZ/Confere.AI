import { randomUUID } from "node:crypto";

export type FakeRow = Record<string, unknown>;

export type FakeTables = Record<string, FakeRow[]>;

export type FakeFilter = {
  column: string;
  operator: "eq" | "in";
  value: unknown;
};

export type FakeQueryLog = {
  table: string;
  operation: "select" | "insert" | "update" | "delete";
  filters: FakeFilter[];
};

export type FakeError = {
  code?: string;
  message: string;
};

export type FakeResponse = {
  data: unknown;
  error: FakeError | null;
};

type Operation = FakeQueryLog["operation"];

/**
 * Fake mínimo do client admin do Supabase.
 *
 * Aplica de verdade `.eq()` e `.in()` sobre as tabelas em memória — se uma
 * função esquecer o filtro de `tenant_id`, o teste enxerga linhas de outro
 * tenant e falha. Não simula RLS: o isolamento precisa estar na query.
 */
export class FakeSupabase {
  readonly tables: FakeTables;
  readonly queries: FakeQueryLog[] = [];
  private readonly pendingErrors: FakeError[] = [];

  constructor(tables: FakeTables = {}) {
    this.tables = tables;
  }

  from(table: string): FakeQueryBuilder {
    if (!this.tables[table]) {
      this.tables[table] = [];
    }
    return new FakeQueryBuilder(this, table);
  }

  /**
   * Enfileira um erro para a próxima query executada (uma única vez).
   * A query falha sem alterar as tabelas.
   */
  failNext(error: FakeError | string): this {
    this.pendingErrors.push(
      typeof error === "string" ? { message: error } : error,
    );
    return this;
  }

  takePendingError(): FakeError | null {
    return this.pendingErrors.shift() ?? null;
  }

  /** Linhas da tabela para asserções, criando-a vazia se necessário. */
  rows(table: string): FakeRow[] {
    let rows = this.tables[table];
    if (!rows) {
      rows = [];
      this.tables[table] = rows;
    }
    return rows;
  }
}

export class FakeQueryBuilder implements PromiseLike<FakeResponse> {
  private operation: Operation = "select";
  private payload: FakeRow | FakeRow[] | null = null;
  private columns: string | undefined;
  private filters: FakeFilter[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private returnsRows = false;
  private response: FakeResponse | null = null;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select(columns?: string): this {
    if (this.operation !== "select") {
      this.returnsRows = true;
    }
    this.columns = columns;
    return this;
  }

  update(patch: FakeRow): this {
    this.operation = "update";
    this.payload = patch;
    return this;
  }

  insert(rows: FakeRow | FakeRow[]): this {
    this.operation = "insert";
    this.payload = rows;
    return this;
  }

  delete(): this {
    this.operation = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, operator: "eq", value });
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    this.filters.push({ column, operator: "in", value: values });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  maybeSingle(): Promise<{
    data: FakeRow | null;
    error: FakeError | null;
  }> {
    const result = this.execute();
    return Promise.resolve({ data: this.firstRow(result), error: result.error });
  }

  single(): Promise<{
    data: FakeRow | null;
    error: FakeError | null;
  }> {
    const result = this.execute();
    return Promise.resolve({ data: this.firstRow(result), error: result.error });
  }

  then<TResult1 = FakeResponse, TResult2 = never>(
    onfulfilled?:
      ((value: FakeResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private firstRow(result: FakeResponse = this.execute()): FakeRow | null {
    if (Array.isArray(result.data)) {
      return (result.data[0] as FakeRow | undefined) ?? null;
    }
    return (result.data as FakeRow | null) ?? null;
  }

  private execute(): FakeResponse {
    if (this.response) return this.response;

    const failure = this.db.takePendingError();
    if (failure) {
      this.db.queries.push({
        table: this.table,
        operation: this.operation,
        filters: [...this.filters],
      });
      this.response = { data: null, error: failure };
      return this.response;
    }

    const rows = this.db.rows(this.table);
    const matched = rows.filter((row) => this.matches(row));
    const ordered = this.applyLimit(this.applyOrder(matched));

    let data: unknown = null;

    switch (this.operation) {
      case "select": {
        data = ordered.map((row) => this.project(row));
        break;
      }
      case "insert": {
        const inputs = Array.isArray(this.payload)
          ? this.payload
          : this.payload
            ? [this.payload]
            : [];
        const inserted = inputs.map((row) => ({
          ...row,
          id: row.id ?? randomUUID(),
        }));
        rows.push(...inserted);
        data = this.returnsRows
          ? inserted.map((row) => this.project(row))
          : null;
        break;
      }
      case "update": {
        const patch = (this.payload ?? {}) as FakeRow;
        for (const row of ordered) {
          Object.assign(row, patch);
        }
        data = this.returnsRows
          ? ordered.map((row) => this.project(row))
          : null;
        break;
      }
      case "delete": {
        const removed = new Set(ordered);
        const remaining = rows.filter((row) => !removed.has(row));
        rows.length = 0;
        rows.push(...remaining);
        data = this.returnsRows
          ? ordered.map((row) => this.project(row))
          : null;
        break;
      }
    }

    this.db.queries.push({
      table: this.table,
      operation: this.operation,
      filters: [...this.filters],
    });
    this.response = { data, error: null };
    return this.response;
  }

  private matches(row: FakeRow): boolean {
    return this.filters.every((filter) => {
      const value = row[filter.column];
      if (filter.operator === "eq") {
        return value === filter.value;
      }
      return (filter.value as readonly unknown[]).includes(value);
    });
  }

  private applyOrder(rows: FakeRow[]): FakeRow[] {
    if (!this.orderBy) return rows;
    const { column, ascending } = this.orderBy;
    return [...rows].sort((a, b) => {
      const aValue = a[column] as string | number | null | undefined;
      const bValue = b[column] as string | number | null | undefined;
      if (aValue === bValue) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      const result = aValue < bValue ? -1 : 1;
      return ascending ? result : -result;
    });
  }

  private applyLimit(rows: FakeRow[]): FakeRow[] {
    if (this.limitCount == null) return rows;
    return rows.slice(0, this.limitCount);
  }

  private project(row: FakeRow): FakeRow {
    if (!this.columns || this.columns.trim() === "*") {
      return { ...row };
    }
    const projected: FakeRow = {};
    for (const column of this.columns
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)) {
      if (Object.prototype.hasOwnProperty.call(row, column)) {
        projected[column] = row[column];
      }
    }
    return projected;
  }
}
