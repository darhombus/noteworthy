
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "entries": {
                  Row: {
                    "content": NonNullable<Json>,"created_at": string,"deleted_at": string | null,"deleted_with_journal": boolean,"entry_date": string,"entry_id": string,"is_favorite": boolean,"is_hidden": boolean,"is_pinned": boolean,"journal_id": string,"last_save_id": string | null,"pinned_at": string | null,"revision": number,"search_text": string | null,"title": string | null,"updated_at": string,"word_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "content"?: NonNullable<Json>,"created_at"?: string,"deleted_at"?: string | null,"deleted_with_journal"?: boolean,"entry_date"?: string,"entry_id"?: string,"is_favorite"?: boolean,"is_hidden"?: boolean,"is_pinned"?: boolean,"journal_id": string,"last_save_id"?: string | null,"pinned_at"?: string | null,"revision"?: number,"search_text"?: never,"title"?: string | null,"updated_at"?: string,"word_count"?: number
                  }
                  Update: {
                    "content"?: NonNullable<Json>,"created_at"?: string,"deleted_at"?: string | null,"deleted_with_journal"?: boolean,"entry_date"?: string,"entry_id"?: string,"is_favorite"?: boolean,"is_hidden"?: boolean,"is_pinned"?: boolean,"journal_id"?: string,"last_save_id"?: string | null,"pinned_at"?: string | null,"revision"?: number,"search_text"?: never,"title"?: string | null,"updated_at"?: string,"word_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "entries_journal_id_fkey"
      columns: ["journal_id"]
isOneToOne: false
      referencedRelation: "journals"
      referencedColumns: ["journal_id"]
    }
                  ]
                },"entry_tags": {
                  Row: {
                    "entry_id": string,"tag_id": string,"tagged_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "entry_id": string,"tag_id": string,"tagged_at"?: string
                  }
                  Update: {
                    "entry_id"?: string,"tag_id"?: string,"tagged_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "entry_tags_entry_id_fkey"
      columns: ["entry_id"]
isOneToOne: false
      referencedRelation: "entries"
      referencedColumns: ["entry_id"]
    },{
      foreignKeyName: "entry_tags_tag_id_fkey"
      columns: ["tag_id"]
isOneToOne: false
      referencedRelation: "tags"
      referencedColumns: ["tag_id"]
    }
                  ]
                },"journals": {
                  Row: {
                    "color": string,"created_at": string,"deleted_at": string | null,"description": string | null,"entry_count": number,"font": string,"hidden_entry_count": number,"hidden_word_count": number,"icon": string,"is_favorite": boolean,"is_hidden": boolean,"journal_id": string,"text_size": string,"title": string,"total_word_count": number,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string,"created_at"?: string,"deleted_at"?: string | null,"description"?: string | null,"entry_count"?: number,"font"?: string,"hidden_entry_count"?: number,"hidden_word_count"?: number,"icon"?: string,"is_favorite"?: boolean,"is_hidden"?: boolean,"journal_id"?: string,"text_size"?: string,"title": string,"total_word_count"?: number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "color"?: string,"created_at"?: string,"deleted_at"?: string | null,"description"?: string | null,"entry_count"?: number,"font"?: string,"hidden_entry_count"?: number,"hidden_word_count"?: number,"icon"?: string,"is_favorite"?: boolean,"is_hidden"?: boolean,"journal_id"?: string,"text_size"?: string,"title"?: string,"total_word_count"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"media": {
                  Row: {
                    "alt_text": string | null,"deleted_at": string | null,"duration": number | null,"entry_id": string,"file_name": string,"file_size": number,"file_type": string,"file_url": string,"height": number | null,"media_id": string,"mime_type": string,"object_path": string | null,"thumbnail_url": string | null,"uploaded_at": string,"width": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "alt_text"?: string | null,"deleted_at"?: string | null,"duration"?: number | null,"entry_id": string,"file_name": string,"file_size": number,"file_type": string,"file_url": string,"height"?: number | null,"media_id"?: string,"mime_type": string,"object_path"?: string | null,"thumbnail_url"?: string | null,"uploaded_at"?: string,"width"?: number | null
                  }
                  Update: {
                    "alt_text"?: string | null,"deleted_at"?: string | null,"duration"?: number | null,"entry_id"?: string,"file_name"?: string,"file_size"?: number,"file_type"?: string,"file_url"?: string,"height"?: number | null,"media_id"?: string,"mime_type"?: string,"object_path"?: string | null,"thumbnail_url"?: string | null,"uploaded_at"?: string,"width"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "media_entry_id_fkey"
      columns: ["entry_id"]
isOneToOne: false
      referencedRelation: "entries"
      referencedColumns: ["entry_id"]
    }
                  ]
                },"media_released": {
                  Row: {
                    "path": string,"released_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "path": string,"released_at": string
                  }
                  Update: {
                    "path"?: string,"released_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"full_name": string,"preferences": NonNullable<Json>,"privacy_pin_hash": string | null,"privacy_pin_type": string,"updated_at": string,"user_id": string,"vault_auto_lock_minutes": number,"vault_secret_hash": string | null,"vault_secret_type": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"full_name"?: string,"preferences"?: NonNullable<Json>,"privacy_pin_hash"?: string | null,"privacy_pin_type"?: string,"updated_at"?: string,"user_id": string,"vault_auto_lock_minutes"?: number,"vault_secret_hash"?: string | null,"vault_secret_type"?: string | null
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"full_name"?: string,"preferences"?: NonNullable<Json>,"privacy_pin_hash"?: string | null,"privacy_pin_type"?: string,"updated_at"?: string,"user_id"?: string,"vault_auto_lock_minutes"?: number,"vault_secret_hash"?: string | null,"vault_secret_type"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"tags": {
                  Row: {
                    "color": string,"created_at": string,"tag_id": string,"tag_name": string,"usage_count": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string,"created_at"?: string,"tag_id"?: string,"tag_name": string,"usage_count"?: number,"user_id": string
                  }
                  Update: {
                    "color"?: string,"created_at"?: string,"tag_id"?: string,"tag_name"?: string,"usage_count"?: number,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "bin_items":
{ Args: Record<PropertyKey, never>; Returns: {
              "bytes": number,"deleted_at": string,"entries": number,"files": number,"id": string,"journal_deleted": boolean,"journal_id": string,"journal_title": string,"kind": string,"title": string
            }[]
                           },
"delete_entry_forever":
{ Args: { "entry": string }; Returns: string[]
                           },
"delete_journal_forever":
{ Args: { "journal": string }; Returns: string[]
                           },
"empty_bin":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"entry_media_paths":
{ Args: { "body": Json }; Returns: string[]
                           },
"extract_tiptap_text":
{ Args: { "doc": Json }; Returns: string
                           },
"find_entries":
{ Args: { "after_row"?: string,"from_day"?: string,"in_journal"?: string,"query_text"?: string,"to_day"?: string }; Returns: {
              "entry_date": string,"entry_id": string,"journal_color": string,"journal_id": string,"journal_title": string,"row_cursor": string,"snippet": string,"snippet_at_end": boolean,"snippet_at_start": boolean,"tier": number,"title": string,"total": number
            }[]
                           },
"find_journals":
{ Args: { "query_text"?: string }; Returns: {
              "color": string,"entry_count": number,"icon": string,"journal_id": string,"title": string,"total": number
            }[]
                           },
"fn_bin_unnamed":
{ Args: { "account": string,"candidates": (string)[] }; Returns: string[]
                           },
"fn_bin_waiting":
{ Args: { "account": string }; Returns: {
              "path": string,"released_at": string,"size": number,"type": string
            }[]
                           },
"fn_compute_word_count":
{ Args: { "content": Json }; Returns: number
                           },
"get_dashboard_snapshot":
{ Args: Record<PropertyKey, never>; Returns: {
              "best_streak": number,"current_streak": number,"recent_entries": Json,"this_month": number,"this_week": number,"top_tag": string,"total_entries": number,"week_counts": (number)[]
            }[]
                           },
"is_waiting_file":
{ Args: { "file": string }; Returns: boolean
                           },
"media_allowance_remaining":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"media_breakdown":
{ Args: Record<PropertyKey, never>; Returns: {
              "audio": number,"bin": number,"images": number,"total": number,"video": number,"waiting": number
            }[]
                           },
"remove_unused_media":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"restore_entry":
{ Args: { "entry": string }; Returns: {
              "entries_restored": number,"journal_restored": boolean
            }[]
                           },
"restore_journal":
{ Args: { "journal": string }; Returns: number
                           },
"search_words":
{ Args: { "query_text": string }; Returns: (string)[]
                           },
"show_limit":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"show_trgm":
{ Args: { "": string }; Returns: (string)[]
                           },
"unused_media":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"waiting_files":
{ Args: Record<PropertyKey, never>; Returns: {
              "path": string,"released_at": string,"size": number,"type": string
            }[]
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
