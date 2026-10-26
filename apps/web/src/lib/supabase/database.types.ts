/**
 * Tipos gerados do schema do Supabase (cloud `pavxbcsolcvekwslhzmf`).
 *
 * Regenerar via MCP do Supabase (`generate_typescript_types`) ou
 * `supabase gen types typescript --linked` após mudanças de schema.
 * Não editar à mão.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      ai_jobs: {
        Row: {
          attempts: number;
          created_at: string;
          error_message: string | null;
          file_name: string;
          finished_at: string | null;
          id: string;
          import_id: string | null;
          media_type: string;
          result: Json | null;
          sha256: string;
          size_bytes: number;
          started_at: string | null;
          status: string;
          storage_path: string;
          tenant_id: string;
          user_id: string | null;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          error_message?: string | null;
          file_name: string;
          finished_at?: string | null;
          id?: string;
          import_id?: string | null;
          media_type: string;
          result?: Json | null;
          sha256: string;
          size_bytes: number;
          started_at?: string | null;
          status?: string;
          storage_path: string;
          tenant_id: string;
          user_id?: string | null;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          error_message?: string | null;
          file_name?: string;
          finished_at?: string | null;
          id?: string;
          import_id?: string | null;
          media_type?: string;
          result?: Json | null;
          sha256?: string;
          size_bytes?: number;
          started_at?: string | null;
          status?: string;
          storage_path?: string;
          tenant_id?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ai_jobs_import_id_fkey";
            columns: ["import_id"];
            isOneToOne: false;
            referencedRelation: "imports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_jobs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_logs: {
        Row: {
          capability: string;
          cost_usd: number | null;
          created_at: string;
          error_message: string | null;
          id: string;
          import_id: string | null;
          latency_ms: number;
          model: string;
          reasoning_tokens: number;
          status: string;
          tenant_id: string;
          tokens_in: number;
          tokens_out: number;
        };
        Insert: {
          capability: string;
          cost_usd?: number | null;
          created_at?: string;
          error_message?: string | null;
          id?: string;
          import_id?: string | null;
          latency_ms?: number;
          model: string;
          reasoning_tokens?: number;
          status: string;
          tenant_id: string;
          tokens_in?: number;
          tokens_out?: number;
        };
        Update: {
          capability?: string;
          cost_usd?: number | null;
          created_at?: string;
          error_message?: string | null;
          id?: string;
          import_id?: string | null;
          latency_ms?: number;
          model?: string;
          reasoning_tokens?: number;
          status?: string;
          tenant_id?: string;
          tokens_in?: number;
          tokens_out?: number;
        };
        Relationships: [
          {
            foreignKeyName: "ai_logs_import_id_fkey";
            columns: ["import_id"];
            isOneToOne: false;
            referencedRelation: "imports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_logs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      analysis_results: {
        Row: {
          analysis_type: string;
          created_at: string;
          findings: Json;
          id: string;
          import_id: string;
          severity: string;
          tenant_id: string;
        };
        Insert: {
          analysis_type: string;
          created_at?: string;
          findings?: Json;
          id?: string;
          import_id: string;
          severity?: string;
          tenant_id: string;
        };
        Update: {
          analysis_type?: string;
          created_at?: string;
          findings?: Json;
          id?: string;
          import_id?: string;
          severity?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "analysis_results_import_id_fkey";
            columns: ["import_id"];
            isOneToOne: false;
            referencedRelation: "imports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "analysis_results_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      app_settings: {
        Row: {
          key: string;
          model: string | null;
          provider: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          key: string;
          model?: string | null;
          provider?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          key?: string;
          model?: string | null;
          provider?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          action: string;
          after_state: Json | null;
          before_state: Json | null;
          created_at: string;
          entity: string;
          entity_id: string;
          id: string;
          tenant_id: string;
          user_id: string | null;
        };
        Insert: {
          action: string;
          after_state?: Json | null;
          before_state?: Json | null;
          created_at?: string;
          entity: string;
          entity_id: string;
          id?: string;
          tenant_id: string;
          user_id?: string | null;
        };
        Update: {
          action?: string;
          after_state?: Json | null;
          before_state?: Json | null;
          created_at?: string;
          entity?: string;
          entity_id?: string;
          id?: string;
          tenant_id?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          content_type: string | null;
          created_at: string;
          doc_type: string;
          id: string;
          import_id: string;
          original_filename: string | null;
          sha256: string;
          size_bytes: number | null;
          status: string;
          storage_path: string;
          tenant_id: string;
          version: number;
        };
        Insert: {
          content_type?: string | null;
          created_at?: string;
          doc_type: string;
          id?: string;
          import_id: string;
          original_filename?: string | null;
          sha256?: string;
          size_bytes?: number | null;
          status?: string;
          storage_path: string;
          tenant_id: string;
          version?: number;
        };
        Update: {
          content_type?: string | null;
          created_at?: string;
          doc_type?: string;
          id?: string;
          import_id?: string;
          original_filename?: string | null;
          sha256?: string;
          size_bytes?: number | null;
          status?: string;
          storage_path?: string;
          tenant_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "documents_import_id_fkey";
            columns: ["import_id"];
            isOneToOne: false;
            referencedRelation: "imports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      extraction_results: {
        Row: {
          confidence: Json;
          created_at: string;
          document_id: string;
          id: string;
          model: string;
          payload: Json;
          tenant_id: string;
          tokens_used: number | null;
        };
        Insert: {
          confidence?: Json;
          created_at?: string;
          document_id: string;
          id?: string;
          model: string;
          payload: Json;
          tenant_id: string;
          tokens_used?: number | null;
        };
        Update: {
          confidence?: Json;
          created_at?: string;
          document_id?: string;
          id?: string;
          model?: string;
          payload?: Json;
          tenant_id?: string;
          tokens_used?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "extraction_results_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "extraction_results_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      imports: {
        Row: {
          bl_number: string | null;
          consignee_divergences: Json | null;
          consignee_id: string | null;
          created_at: string;
          created_by: string | null;
          currency: string | null;
          id: string;
          incoterm: string | null;
          invoice_number: string | null;
          notify_id: string | null;
          reference_number: string | null;
          status: string;
          supplier_name: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          bl_number?: string | null;
          consignee_divergences?: Json | null;
          consignee_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string | null;
          id?: string;
          incoterm?: string | null;
          invoice_number?: string | null;
          notify_id?: string | null;
          reference_number?: string | null;
          status?: string;
          supplier_name?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          bl_number?: string | null;
          consignee_divergences?: Json | null;
          consignee_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string | null;
          id?: string;
          incoterm?: string | null;
          invoice_number?: string | null;
          notify_id?: string | null;
          reference_number?: string | null;
          status?: string;
          supplier_name?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "imports_consignee_id_fkey";
            columns: ["consignee_id"];
            isOneToOne: false;
            referencedRelation: "parties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "imports_notify_id_fkey";
            columns: ["notify_id"];
            isOneToOne: false;
            referencedRelation: "parties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "imports_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      ncms: {
        Row: {
          code: string;
          created_at: string;
          description: string;
          id: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          description: string;
          id?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string;
          id?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ncms_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      parties: {
        Row: {
          address: string;
          city: string | null;
          cnpj: string;
          cnpj_digits: string;
          complement: string | null;
          country: string | null;
          created_at: string;
          id: string;
          name: string;
          other_info: string | null;
          postal_code: string | null;
          state: string | null;
          street: string | null;
          street_number: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          address: string;
          city?: string | null;
          cnpj: string;
          cnpj_digits: string;
          complement?: string | null;
          country?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          other_info?: string | null;
          postal_code?: string | null;
          state?: string | null;
          street?: string | null;
          street_number?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          address?: string;
          city?: string | null;
          cnpj?: string;
          cnpj_digits?: string;
          complement?: string | null;
          country?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          other_info?: string | null;
          postal_code?: string | null;
          state?: string | null;
          street?: string | null;
          street_number?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "parties_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      product_matches: {
        Row: {
          created_at: string;
          differences: Json;
          extracted_data: Json;
          id: string;
          import_id: string;
          match_status: string;
          product_id: string | null;
          tenant_id: string;
        };
        Insert: {
          created_at?: string;
          differences?: Json;
          extracted_data: Json;
          id?: string;
          import_id: string;
          match_status: string;
          product_id?: string | null;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          differences?: Json;
          extracted_data?: Json;
          id?: string;
          import_id?: string;
          match_status?: string;
          product_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_matches_import_id_fkey";
            columns: ["import_id"];
            isOneToOne: false;
            referencedRelation: "imports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_matches_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_matches_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          attributes: Json;
          created_at: string;
          description: string;
          id: string;
          ncm: string | null;
          origin: string;
          sku: string;
          tenant_id: string;
          unit_of_measure: string | null;
          unit_weight: number | null;
          updated_at: string;
        };
        Insert: {
          attributes?: Json;
          created_at?: string;
          description: string;
          id?: string;
          ncm?: string | null;
          origin?: string;
          sku: string;
          tenant_id: string;
          unit_of_measure?: string | null;
          unit_weight?: number | null;
          updated_at?: string;
        };
        Update: {
          attributes?: Json;
          created_at?: string;
          description?: string;
          id?: string;
          ncm?: string | null;
          origin?: string;
          sku?: string;
          tenant_id?: string;
          unit_of_measure?: string | null;
          unit_weight?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limit_buckets: {
        Row: {
          bucket: string;
          count: number;
          window_start: string;
        };
        Insert: {
          bucket: string;
          count?: number;
          window_start: string;
        };
        Update: {
          bucket?: string;
          count?: number;
          window_start?: string;
        };
        Relationships: [];
      };
      tenant_members: {
        Row: {
          company_name: string | null;
          created_at: string;
          full_name: string | null;
          role: string;
          tenant_id: string;
          user_id: string;
        };
        Insert: {
          company_name?: string | null;
          created_at?: string;
          full_name?: string | null;
          role: string;
          tenant_id: string;
          user_id: string;
        };
        Update: {
          company_name?: string | null;
          created_at?: string;
          full_name?: string | null;
          role?: string;
          tenant_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenant_settings: {
        Row: {
          ai_overrides: Json;
          confidence_threshold: number;
          default_consignee_party_id: string | null;
          tenant_id: string;
          updated_at: string;
          validation_rules: Json;
        };
        Insert: {
          ai_overrides?: Json;
          confidence_threshold?: number;
          default_consignee_party_id?: string | null;
          tenant_id: string;
          updated_at?: string;
          validation_rules?: Json;
        };
        Update: {
          ai_overrides?: Json;
          confidence_threshold?: number;
          default_consignee_party_id?: string | null;
          tenant_id?: string;
          updated_at?: string;
          validation_rules?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: true;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenants: {
        Row: {
          created_at: string;
          document_cnpj: string | null;
          id: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          document_cnpj?: string | null;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          document_cnpj?: string | null;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_ai_job: {
        Args: { p_job_id: string };
        Returns: {
          attempts: number;
          created_at: string;
          error_message: string | null;
          file_name: string;
          finished_at: string | null;
          id: string;
          import_id: string | null;
          media_type: string;
          result: Json | null;
          sha256: string;
          size_bytes: number;
          started_at: string | null;
          status: string;
          storage_path: string;
          tenant_id: string;
          user_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "ai_jobs";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      claim_next_ai_job: {
        Args: { p_max_attempts?: number; p_stale_seconds?: number };
        Returns: {
          attempts: number;
          created_at: string;
          error_message: string | null;
          file_name: string;
          finished_at: string | null;
          id: string;
          import_id: string | null;
          media_type: string;
          result: Json | null;
          sha256: string;
          size_bytes: number;
          started_at: string | null;
          status: string;
          storage_path: string;
          tenant_id: string;
          user_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "ai_jobs";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      consume_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number };
        Returns: {
          allowed: boolean;
          remaining: number;
          reset_at: string;
        }[];
      };
      create_tenant_with_owner: { Args: { p_name: string }; Returns: string };
      custom_access_token_hook: { Args: { event: Json }; Returns: Json };
      delete_import: {
        Args: { p_import_id: string; p_tenant_id: string };
        Returns: string[];
      };
      email_registered: { Args: { p_email: string }; Returns: boolean };
      merge_imports: {
        Args: {
          p_source_id: string;
          p_supplier_name?: string;
          p_target_id: string;
          p_tenant_id: string;
        };
        Returns: string;
      };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
