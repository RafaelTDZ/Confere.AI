import { randomUUID } from "node:crypto";

export type FakeRow = Record<string, unknown>;

export type FakeTables = Record<string, FakeRow[]>;

export type FakeFilter = {
  column: string;
  operator: "eq" | "in" | "ilike" | "or";
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
  count?: number | null;
};

type FakeOrCondition = {
  column: string;
  pattern: string;
};

/**
 * Converte um padrão SQL LIKE em RegExp ancorada e case-insensitive.
 * `%` casa qualquer sequência, `_` casa um caractere e `\` escapa ambos.
 */
function likeToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? "";
    if (char === "\\") {
      const next = pattern[index + 1];
      if (next !== undefined) {
        source += next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        index += 1;
        continue;
      }
      source += "\\\\";
      continue;
    }
    if (char === "%") {
      source += ".*";
      continue;
    }
    if (char === "_") {
      source += ".";
      continue;
    }
    source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "i");
}

function matchesLike(value: unknown, pattern: string): boolean {
  if (value == null) return false;
  const text = typeof value === "string" ? value : String(value);
  return likeToRegExp(pattern).test(text);
}

/** Aceita apenas a sintaxe usada no projeto: `col.ilike.%termo%,outra.ilike.%termo%`. */
function parseOrExpression(expression: string): FakeOrCondition[] {
  const conditions = expression
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const match = /^([A-Za-z0-9_]+)\.ilike\.(.*)$/.exec(part);
      if (!match) {
        throw new Error(
          `FakeSupabase: expressão .or() não suportada ("${part}"). Use "coluna.ilike.padrão" separado por vírgulas.`,
        );
      }
      return { column: match[1] ?? "", pattern: match[2] ?? "" };
    });

  if (conditions.length === 0) {
    throw new Error(
      "FakeSupabase: expressão .or() vazia; informe ao menos uma condição.",
    );
  }

  return conditions;
}

type Operation = FakeQueryLog["operation"];

/** Restringe o próximo erro a uma tabela e/ou operação específicas. */
export type FakeErrorTarget = {
  table?: string;
  operation?: Operation;
};

export type FakeStorageRemoval = {
  bucket: string;
  paths: string[];
};

export type FakeStorageUpload = {
  bucket: string;
  path: string;
  bytes: Uint8Array;
  options?: { contentType?: string; upsert?: boolean };
};

export type FakeStorageDownload = {
  bucket: string;
  path: string;
};

export type FakeStorageOptions = {
  removeError?: FakeError | string | null;
};

export type FakeSupabaseOptions = {
  storage?: FakeStorageOptions;
  /** Executado antes de cada insert (simula corrida: outra request grava a linha primeiro). */
  beforeInsert?: (table: string, row: FakeRow) => void;
  /** Colunas com índice único por tabela. Só valida quando todas as colunas são não nulas (índice parcial). */
  unique?: Record<string, string[][]>;
};

function toFakeError(error: FakeError | string): FakeError {
  return typeof error === "string" ? { message: error } : error;
}

export class FakeStorageClient {
  readonly removals: FakeStorageRemoval[] = [];
  readonly uploads: FakeStorageUpload[] = [];
  readonly downloads: FakeStorageDownload[] = [];
  readonly files = new Map<
    string,
    { bytes: Uint8Array; mediaType: string }
  >();
  removeError: FakeError | null;
  uploadError: FakeError | null = null;
  downloadError: FakeError | null = null;

  constructor(options: FakeStorageOptions = {}) {
    this.removeError = options.removeError
      ? toFakeError(options.removeError)
      : null;
  }

  from(bucket: string): {
    remove: (
      paths: string[],
    ) => Promise<{
      data: Array<{ name: string }> | null;
      error: FakeError | null;
    }>;
    upload: (
      path: string,
      bytes: Uint8Array,
      options?: { contentType?: string; upsert?: boolean },
    ) => Promise<{
      data: { path: string } | null;
      error: FakeError | null;
    }>;
    download: (path: string) => Promise<{
      data: Blob | null;
      error: FakeError | null;
    }>;
  } {
    return {
      remove: (paths) => {
        this.removals.push({ bucket, paths: [...paths] });
        if (this.removeError) {
          return Promise.resolve({ data: null, error: this.removeError });
        }
        for (const path of paths) this.files.delete(path);
        return Promise.resolve({
          data: paths.map((path) => ({ name: path })),
          error: null,
        });
      },
      upload: (path, bytes, options) => {
        this.uploads.push({ bucket, path, bytes, options });
        if (this.uploadError) {
          return Promise.resolve({ data: null, error: this.uploadError });
        }
        this.files.set(path, {
          bytes,
          mediaType: options?.contentType ?? "application/octet-stream",
        });
        return Promise.resolve({ data: { path }, error: null });
      },
      download: (path) => {
        this.downloads.push({ bucket, path });
        if (this.downloadError) {
          return Promise.resolve({ data: null, error: this.downloadError });
        }
        const file = this.files.get(path);
        if (!file) {
          return Promise.resolve({
            data: null,
            error: { message: `arquivo ${path} não encontrado` },
          });
        }
        const buffer = file.bytes.buffer.slice(
          file.bytes.byteOffset,
          file.bytes.byteOffset + file.bytes.byteLength,
        ) as ArrayBuffer;
        return Promise.resolve({
          data: new Blob([buffer], { type: file.mediaType }),
          error: null,
        });
      },
    };
  }
}

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
  readonly storage: FakeStorageClient;
  readonly options: FakeSupabaseOptions;
  private readonly pendingErrors: Array<{
    error: FakeError;
    target: FakeErrorTarget;
  }> = [];

  constructor(tables: FakeTables = {}, options: FakeSupabaseOptions = {}) {
    this.tables = tables;
    this.options = {
      storage: options.storage,
      beforeInsert: options.beforeInsert,
      unique: options.unique,
    };
    this.storage = new FakeStorageClient(options.storage);
  }

  from(table: string): FakeQueryBuilder {
    if (!this.tables[table]) {
      this.tables[table] = [];
    }
    return new FakeQueryBuilder(this, table);
  }

  /**
   * Enfileira um erro para a próxima query executada (uma única vez).
   * A query falha sem alterar as tabelas. Um alvo opcional restringe o erro
   * à tabela e/ou operação informadas; as demais queries seguem normais.
   */
  failNext(error: FakeError | string, target: FakeErrorTarget = {}): this {
    this.pendingErrors.push({ error: toFakeError(error), target });
    return this;
  }

  takePendingError(query?: {
    table: string;
    operation: Operation;
  }): FakeError | null {
    if (!query) {
      return this.pendingErrors.shift()?.error ?? null;
    }
    const index = this.pendingErrors.findIndex(
      ({ target }) =>
        (target.table === undefined || target.table === query.table) &&
        (target.operation === undefined ||
          target.operation === query.operation),
    );
    if (index === -1) return null;
    const [entry] = this.pendingErrors.splice(index, 1);
    return entry?.error ?? null;
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

  /**
   * Simula um índice único (parcial) antes de inserir: só acusa conflito quando
   * todas as colunas do índice estão preenchidas — como no Postgres, chave nula
   * não colide.
   */
  findUniqueConflict(table: string, row: FakeRow): FakeError | null {
    const uniqueSets = this.options.unique?.[table];
    if (!uniqueSets) return null;
    for (const columns of uniqueSets) {
      if (columns.some((column) => row[column] == null)) continue;
      const duplicate = this.rows(table).find((candidate) =>
        columns.every((column) => candidate[column] === row[column]),
      );
      if (duplicate) {
        return {
          code: "23505",
          message: `duplicate key value violates unique constraint "${table}_unique_${columns.join("_")}"`,
        };
      }
    }
    return null;
  }

  /** RPCs chamadas, na ordem, com os parâmetros recebidos. */
  readonly rpcCalls: Array<{
    name: string;
    params: Record<string, unknown>;
  }> = [];

  private readonly pendingRpcs: Array<{
    name: string;
    response: FakeResponse;
  }> = [];

  /**
   * Enfileira a resposta de uma RPC (uma única vez, casada pelo nome).
   * Sem resposta enfileirada, a chamada falha para o teste perceber o esquecimento.
   */
  onRpc(
    name: string,
    response: { data?: unknown; error?: FakeError | string | null } = {},
  ): this {
    this.pendingRpcs.push({
      name,
      response: {
        data: response.data ?? null,
        error: response.error ? toFakeError(response.error) : null,
      },
    });
    return this;
  }

  rpc(
    name: string,
    params: Record<string, unknown> = {},
  ): Promise<FakeResponse> {
    this.rpcCalls.push({ name, params });
    const index = this.pendingRpcs.findIndex((entry) => entry.name === name);
    if (index === -1) {
      return Promise.resolve({
        data: null,
        error: {
          code: "PGRST202",
          message: `FakeSupabase: RPC "${name}" não configurada no teste`,
        },
      });
    }
    const [entry] = this.pendingRpcs.splice(index, 1);
    return Promise.resolve(entry?.response ?? { data: null, error: null });
  }
}

export class FakeQueryBuilder implements PromiseLike<FakeResponse> {
  private operation: Operation = "select";
  private payload: FakeRow | FakeRow[] | null = null;
  private columns: string | undefined;
  private filters: FakeFilter[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private rangeBounds: { from: number; to: number } | null = null;
  private countMode: "exact" | null = null;
  private returnsRows = false;
  private response: FakeResponse | null = null;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select(columns?: string, options?: { count?: "exact" }): this {
    if (this.operation !== "select") {
      this.returnsRows = true;
    }
    this.columns = columns;
    this.countMode = options?.count ?? null;
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

  ilike(column: string, pattern: string): this {
    this.filters.push({ column, operator: "ilike", value: pattern });
    return this;
  }

  or(expression: string): this {
    this.filters.push({
      column: "",
      operator: "or",
      value: parseOrExpression(expression),
    });
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

  range(from: number, to: number): this {
    this.rangeBounds = { from, to };
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

    const failure = this.db.takePendingError({
      table: this.table,
      operation: this.operation,
    });
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
    const total = matched.length;
    const ordered = this.applyLimit(this.applyRange(this.applyOrder(matched)));

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
        const inserted: FakeRow[] = [];
        for (const row of inputs) {
          this.db.options.beforeInsert?.(this.table, { ...row });
          const conflict = this.db.findUniqueConflict(this.table, row);
          if (conflict) {
            this.db.queries.push({
              table: this.table,
              operation: this.operation,
              filters: [...this.filters],
            });
            this.response = { data: null, error: conflict };
            return this.response;
          }
          inserted.push({ ...row, id: row.id ?? randomUUID() });
        }
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
    this.response =
      this.operation === "select" && this.countMode === "exact"
        ? { data, error: null, count: total }
        : { data, error: null };
    return this.response;
  }

  private matches(row: FakeRow): boolean {
    return this.filters.every((filter) => {
      const value = row[filter.column];
      switch (filter.operator) {
        case "eq":
          return value === filter.value;
        case "in":
          return (filter.value as readonly unknown[]).includes(value);
        case "ilike":
          return matchesLike(value, filter.value as string);
        case "or":
          return (filter.value as FakeOrCondition[]).some((condition) =>
            matchesLike(row[condition.column], condition.pattern),
          );
      }
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

  private applyRange(rows: FakeRow[]): FakeRow[] {
    if (!this.rangeBounds) return rows;
    const { from, to } = this.rangeBounds;
    return rows.slice(from, to + 1);
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
