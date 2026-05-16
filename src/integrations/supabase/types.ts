export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      branches: {
        Row: {
          address: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          manager_id: string | null
          name_ar: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          manager_id?: string | null
          name_ar: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          manager_id?: string | null
          name_ar?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      catering_customers: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          created_by: string | null
          customer_type: string
          email: string | null
          id: string
          name: string
          notes: string | null
          payment_terms: string | null
          phone: string
          phone2: string | null
          tax_number: string | null
          total_orders: number
          total_spent: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          customer_type?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          payment_terms?: string | null
          phone: string
          phone2?: string | null
          tax_number?: string | null
          total_orders?: number
          total_spent?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          customer_type?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string
          phone2?: string | null
          tax_number?: string | null
          total_orders?: number
          total_spent?: number
          updated_at?: string
        }
        Relationships: []
      }
      catering_inventory_movements: {
        Row: {
          created_at: string
          id: string
          movement_type: string
          notes: string | null
          performed_by: string | null
          quantity: number
          raw_material_id: string
          reference: string | null
          related_order_id: string | null
          related_po_id: string | null
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          movement_type: string
          notes?: string | null
          performed_by?: string | null
          quantity: number
          raw_material_id: string
          reference?: string | null
          related_order_id?: string | null
          related_po_id?: string | null
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          movement_type?: string
          notes?: string | null
          performed_by?: string | null
          quantity?: number
          raw_material_id?: string
          reference?: string | null
          related_order_id?: string | null
          related_po_id?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "catering_inventory_movements_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "catering_raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catering_inventory_movements_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "catering_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catering_inventory_movements_related_po_id_fkey"
            columns: ["related_po_id"]
            isOneToOne: false
            referencedRelation: "catering_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_manufacturing_invoices: {
        Row: {
          batch_quantity: number
          created_at: string
          created_by: string | null
          id: string
          invoice_number: string
          labor_cost: number
          materials_cost: number
          notes: string | null
          overhead_cost: number
          product_id: string
          total_cost: number
          unit_cost: number
        }
        Insert: {
          batch_quantity?: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_number: string
          labor_cost?: number
          materials_cost?: number
          notes?: string | null
          overhead_cost?: number
          product_id: string
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          batch_quantity?: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_number?: string
          labor_cost?: number
          materials_cost?: number
          notes?: string | null
          overhead_cost?: number
          product_id?: string
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "catering_manufacturing_invoices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catering_products"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_order_items: {
        Row: {
          created_at: string
          id: string
          kitchen_section: string
          notes: string | null
          order_id: string
          prep_status: string
          product_id: string | null
          product_image: string | null
          product_name: string
          quantity: number
          total_price: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          kitchen_section?: string
          notes?: string | null
          order_id: string
          prep_status?: string
          product_id?: string | null
          product_image?: string | null
          product_name: string
          quantity?: number
          total_price?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          id?: string
          kitchen_section?: string
          notes?: string | null
          order_id?: string
          prep_status?: string
          product_id?: string | null
          product_image?: string | null
          product_name?: string
          quantity?: number
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "catering_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "catering_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catering_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catering_products"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_orders: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_notes: string | null
          delivery_address: string | null
          delivery_date: string | null
          delivery_fee: number
          delivery_time: string | null
          discount: number
          id: string
          internal_notes: string | null
          kitchen_out_time: string | null
          order_number: string
          payment_method: string
          payment_status: string
          sales_team: string
          serving_time: string | null
          status: string
          subtotal: number
          tax: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name_snapshot: string
          customer_notes?: string | null
          delivery_address?: string | null
          delivery_date?: string | null
          delivery_fee?: number
          delivery_time?: string | null
          discount?: number
          id?: string
          internal_notes?: string | null
          kitchen_out_time?: string | null
          order_number: string
          payment_method?: string
          payment_status?: string
          sales_team?: string
          serving_time?: string | null
          status?: string
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name_snapshot?: string
          customer_notes?: string | null
          delivery_address?: string | null
          delivery_date?: string | null
          delivery_fee?: number
          delivery_time?: string | null
          discount?: number
          id?: string
          internal_notes?: string | null
          kitchen_out_time?: string | null
          order_number?: string
          payment_method?: string
          payment_status?: string
          sales_team?: string
          serving_time?: string | null
          status?: string
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catering_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "catering_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_product_recipe_items: {
        Row: {
          created_at: string
          id: string
          product_id: string
          quantity: number
          raw_material_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          quantity?: number
          raw_material_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          raw_material_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catering_product_recipe_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catering_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catering_product_recipe_items_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "catering_raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_products: {
        Row: {
          ai_reasoning: string | null
          ai_suggested_price: number | null
          category: string | null
          computed_cost: number
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          kitchen_section: string
          market_price_avg: number | null
          market_price_high: number | null
          market_price_low: number | null
          name: string
          sale_price: number
          unit: string
          updated_at: string
        }
        Insert: {
          ai_reasoning?: string | null
          ai_suggested_price?: number | null
          category?: string | null
          computed_cost?: number
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          kitchen_section?: string
          market_price_avg?: number | null
          market_price_high?: number | null
          market_price_low?: number | null
          name: string
          sale_price?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          ai_reasoning?: string | null
          ai_suggested_price?: number | null
          category?: string | null
          computed_cost?: number
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          kitchen_section?: string
          market_price_avg?: number | null
          market_price_high?: number | null
          market_price_low?: number | null
          name?: string
          sale_price?: number
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      catering_purchase_order_items: {
        Row: {
          created_at: string
          id: string
          po_id: string
          quantity: number
          raw_material_id: string
          received_qty: number
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          id?: string
          po_id: string
          quantity?: number
          raw_material_id: string
          received_qty?: number
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          created_at?: string
          id?: string
          po_id?: string
          quantity?: number
          raw_material_id?: string
          received_qty?: number
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "catering_purchase_order_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "catering_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catering_purchase_order_items_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "catering_raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_purchase_orders: {
        Row: {
          created_at: string
          created_by: string | null
          delivery_to: string
          id: string
          notes: string | null
          po_number: string
          related_order_id: string | null
          status: string
          supplier_id: string | null
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delivery_to?: string
          id?: string
          notes?: string | null
          po_number: string
          related_order_id?: string | null
          status?: string
          supplier_id?: string | null
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delivery_to?: string
          id?: string
          notes?: string | null
          po_number?: string
          related_order_id?: string | null
          status?: string
          supplier_id?: string | null
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catering_purchase_orders_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "catering_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catering_purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "catering_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_raw_materials: {
        Row: {
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          low_stock_threshold: number
          name: string
          notes: string | null
          stock: number
          supplier_id: string | null
          unit: string
          unit_cost: number
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          low_stock_threshold?: number
          name: string
          notes?: string | null
          stock?: number
          supplier_id?: string | null
          unit?: string
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          low_stock_threshold?: number
          name?: string
          notes?: string | null
          stock?: number
          supplier_id?: string | null
          unit?: string
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catering_raw_materials_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "catering_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_sales_invoices: {
        Row: {
          created_at: string
          customer_id: string | null
          due_date: string | null
          id: string
          invoice_number: string
          order_id: string
          paid_amount: number
          payment_method: string
          payment_status: string
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          due_date?: string | null
          id?: string
          invoice_number: string
          order_id: string
          paid_amount?: number
          payment_method?: string
          payment_status?: string
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string
          order_id?: string
          paid_amount?: number
          payment_method?: string
          payment_status?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catering_sales_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "catering_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catering_sales_invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "catering_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_suppliers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          payment_terms: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      chick_movements: {
        Row: {
          age_days: number | null
          created_at: string
          dead: number
          id: string
          incoming: number
          movement_date: string
          notes: string | null
          outgoing: number
          sold: number
          source: string
          unit_price: number
        }
        Insert: {
          age_days?: number | null
          created_at?: string
          dead?: number
          id?: string
          incoming?: number
          movement_date: string
          notes?: string | null
          outgoing?: number
          sold?: number
          source: string
          unit_price?: number
        }
        Update: {
          age_days?: number | null
          created_at?: string
          dead?: number
          id?: string
          incoming?: number
          movement_date?: string
          notes?: string | null
          outgoing?: number
          sold?: number
          source?: string
          unit_price?: number
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          email: string | null
          governorate: string | null
          id: string
          name: string
          notes: string | null
          phone: string
          phone2: string | null
          shipping_company: string | null
          source: string | null
          total_orders: number
          total_spent: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          governorate?: string | null
          id?: string
          name: string
          notes?: string | null
          phone: string
          phone2?: string | null
          shipping_company?: string | null
          source?: string | null
          total_orders?: number
          total_spent?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          governorate?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string
          phone2?: string | null
          shipping_company?: string | null
          source?: string | null
          total_orders?: number
          total_spent?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      farm_egg_production: {
        Row: {
          created_at: string
          created_by: string | null
          egg_count: number
          family_id: string | null
          id: string
          notes: string | null
          production_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          egg_count?: number
          family_id?: string | null
          id?: string
          notes?: string | null
          production_date: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          egg_count?: number
          family_id?: string | null
          id?: string
          notes?: string | null
          production_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "farm_egg_production_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "farm_families"
            referencedColumns: ["id"]
          },
        ]
      }
      farm_families: {
        Row: {
          created_at: string
          family_number: string
          female_count: number
          id: string
          male_count: number
          notes: string | null
          pen: string | null
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          family_number: string
          female_count?: number
          id?: string
          male_count?: number
          notes?: string | null
          pen?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          family_number?: string
          female_count?: number
          id?: string
          male_count?: number
          notes?: string | null
          pen?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      farm_feed_log: {
        Row: {
          created_at: string
          feed_type: string
          id: string
          log_date: string
          notes: string | null
          quantity: number
          unit: string
        }
        Insert: {
          created_at?: string
          feed_type: string
          id?: string
          log_date: string
          notes?: string | null
          quantity?: number
          unit?: string
        }
        Update: {
          created_at?: string
          feed_type?: string
          id?: string
          log_date?: string
          notes?: string | null
          quantity?: number
          unit?: string
        }
        Relationships: []
      }
      farm_medications: {
        Row: {
          created_at: string
          dose: string | null
          family_id: string | null
          id: string
          med_date: string
          name: string
          notes: string | null
        }
        Insert: {
          created_at?: string
          dose?: string | null
          family_id?: string | null
          id?: string
          med_date: string
          name: string
          notes?: string | null
        }
        Update: {
          created_at?: string
          dose?: string | null
          family_id?: string | null
          id?: string
          med_date?: string
          name?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "farm_medications_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "farm_families"
            referencedColumns: ["id"]
          },
        ]
      }
      farm_transfers: {
        Row: {
          created_at: string
          created_by: string | null
          damaged: number
          family_id: string | null
          id: string
          notes: string | null
          quantity: number
          transfer_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          damaged?: number
          family_id?: string | null
          id?: string
          notes?: string | null
          quantity?: number
          transfer_date: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          damaged?: number
          family_id?: string | null
          id?: string
          notes?: string | null
          quantity?: number
          transfer_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "farm_transfers_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "farm_families"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_batch_consumption: {
        Row: {
          batch_id: string
          created_at: string
          id: string
          quantity: number
          raw_material_id: string
          total_cost: number
          unit_cost: number
        }
        Insert: {
          batch_id: string
          created_at?: string
          id?: string
          quantity: number
          raw_material_id: string
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          batch_id?: string
          created_at?: string
          id?: string
          quantity?: number
          raw_material_id?: string
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "feed_batch_consumption_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "feed_production_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_batch_consumption_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "feed_raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_batch_events: {
        Row: {
          batch_id: string
          created_at: string
          details: Json | null
          event_type: string
          from_status: string | null
          id: string
          performed_by: string | null
          to_status: string | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          details?: Json | null
          event_type: string
          from_status?: string | null
          id?: string
          performed_by?: string | null
          to_status?: string | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          details?: Json | null
          event_type?: string
          from_status?: string | null
          id?: string
          performed_by?: string | null
          to_status?: string | null
        }
        Relationships: []
      }
      feed_production_batches: {
        Row: {
          actual_quantity: number | null
          batch_number: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          recipe_id: string
          started_at: string | null
          status: string
          target_quantity: number
          total_cost: number
          updated_at: string
        }
        Insert: {
          actual_quantity?: number | null
          batch_number: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          recipe_id: string
          started_at?: string | null
          status?: string
          target_quantity: number
          total_cost?: number
          updated_at?: string
        }
        Update: {
          actual_quantity?: number | null
          batch_number?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          recipe_id?: string
          started_at?: string | null
          status?: string
          target_quantity?: number
          total_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_production_batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "feed_recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_raw_materials: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          low_stock_threshold: number
          name: string
          notes: string | null
          stock: number
          supplier: string | null
          unit: string
          unit_cost: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          low_stock_threshold?: number
          name: string
          notes?: string | null
          stock?: number
          supplier?: string | null
          unit?: string
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          low_stock_threshold?: number
          name?: string
          notes?: string | null
          stock?: number
          supplier?: string | null
          unit?: string
          unit_cost?: number
          updated_at?: string
        }
        Relationships: []
      }
      feed_recipe_history: {
        Row: {
          batch_size: number
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          recipe_id: string
          snapshot: Json
          total_cost: number
          total_quantity: number
        }
        Insert: {
          batch_size: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          recipe_id: string
          snapshot?: Json
          total_cost?: number
          total_quantity?: number
        }
        Update: {
          batch_size?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          recipe_id?: string
          snapshot?: Json
          total_cost?: number
          total_quantity?: number
        }
        Relationships: []
      }
      feed_recipe_items: {
        Row: {
          created_at: string
          id: string
          quantity: number
          raw_material_id: string
          recipe_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          quantity: number
          raw_material_id: string
          recipe_id: string
        }
        Update: {
          created_at?: string
          id?: string
          quantity?: number
          raw_material_id?: string
          recipe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_recipe_items_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "feed_raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_recipe_items_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "feed_recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_recipes: {
        Row: {
          batch_size: number
          created_at: string
          created_by: string | null
          description: string | null
          feed_type: string
          id: string
          is_active: boolean
          name: string
          unit: string
          updated_at: string
        }
        Insert: {
          batch_size?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          feed_type: string
          id?: string
          is_active?: boolean
          name: string
          unit?: string
          updated_at?: string
        }
        Update: {
          batch_size?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          feed_type?: string
          id?: string
          is_active?: boolean
          name?: string
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      hatch_batches: {
        Row: {
          batch_number: string
          candle1_date: string | null
          candle1_fertile: number | null
          candle1_infertile: number | null
          candle2_date: string | null
          candle2_dead: number | null
          candle2_fertile: number | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          entry_date: string | null
          exit_date: string | null
          hatched_chicks: number | null
          hatcher_dead: number | null
          id: string
          machine: string | null
          net_eggs: number
          notes: string | null
          receive_date: string
          received_eggs: number
          status: string
          updated_at: string
        }
        Insert: {
          batch_number: string
          candle1_date?: string | null
          candle1_fertile?: number | null
          candle1_infertile?: number | null
          candle2_date?: string | null
          candle2_dead?: number | null
          candle2_fertile?: number | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          entry_date?: string | null
          exit_date?: string | null
          hatched_chicks?: number | null
          hatcher_dead?: number | null
          id?: string
          machine?: string | null
          net_eggs?: number
          notes?: string | null
          receive_date: string
          received_eggs?: number
          status?: string
          updated_at?: string
        }
        Update: {
          batch_number?: string
          candle1_date?: string | null
          candle1_fertile?: number | null
          candle1_infertile?: number | null
          candle2_date?: string | null
          candle2_dead?: number | null
          candle2_fertile?: number | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          entry_date?: string | null
          exit_date?: string | null
          hatched_chicks?: number | null
          hatcher_dead?: number | null
          id?: string
          machine?: string | null
          net_eggs?: number
          notes?: string | null
          receive_date?: string
          received_eggs?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hatch_batches_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "hatch_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      hatch_customers: {
        Row: {
          created_at: string
          customer_type: string
          hatcher_price: number
          id: string
          incubation_price: number
          infertile_price: number
          is_active: boolean
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_type?: string
          hatcher_price?: number
          id?: string
          incubation_price?: number
          infertile_price?: number
          is_active?: boolean
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_type?: string
          hatcher_price?: number
          id?: string
          incubation_price?: number
          infertile_price?: number
          is_active?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      hatch_daily_ops: {
        Row: {
          capacity: number | null
          created_at: string
          id: string
          notes: string | null
          op_date: string
          status: string
        }
        Insert: {
          capacity?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          op_date: string
          status?: string
        }
        Update: {
          capacity?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          op_date?: string
          status?: string
        }
        Relationships: []
      }
      hatch_maintenance: {
        Row: {
          action: string
          cost: number
          created_at: string
          id: string
          machine: string | null
          maint_date: string
          maint_type: string
          notes: string | null
        }
        Insert: {
          action: string
          cost?: number
          created_at?: string
          id?: string
          machine?: string | null
          maint_date: string
          maint_type?: string
          notes?: string | null
        }
        Update: {
          action?: string
          cost?: number
          created_at?: string
          id?: string
          machine?: string | null
          maint_date?: string
          maint_type?: string
          notes?: string | null
        }
        Relationships: []
      }
      inventory_items: {
        Row: {
          category: string | null
          created_at: string
          expiry_date: string | null
          id: string
          is_active: boolean
          low_stock_threshold: number
          name: string
          notes: string | null
          sku: string | null
          stock: number
          unit: string
          unit_cost: number
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          low_stock_threshold?: number
          name: string
          notes?: string | null
          sku?: string | null
          stock?: number
          unit?: string
          unit_cost?: number
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          low_stock_threshold?: number
          name?: string
          notes?: string | null
          sku?: string | null
          stock?: number
          unit?: string
          unit_cost?: number
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          created_at: string
          destination_warehouse_id: string | null
          id: string
          item_id: string
          movement_type: string
          notes: string | null
          party: string | null
          performed_at: string
          performed_by: string | null
          quantity: number
          reference: string | null
          unit_cost: number | null
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          destination_warehouse_id?: string | null
          id?: string
          item_id: string
          movement_type: string
          notes?: string | null
          party?: string | null
          performed_at?: string
          performed_by?: string | null
          quantity: number
          reference?: string | null
          unit_cost?: number | null
          warehouse_id: string
        }
        Update: {
          created_at?: string
          destination_warehouse_id?: string | null
          id?: string
          item_id?: string
          movement_type?: string
          notes?: string | null
          party?: string | null
          performed_at?: string
          performed_by?: string | null
          quantity?: number
          reference?: string | null
          unit_cost?: number | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_destination_warehouse_id_fkey"
            columns: ["destination_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_status: {
        Row: {
          created_at: string
          product_id: string
          status: string
          updated_at: string
          updated_by: string | null
          updated_by_name: string | null
        }
        Insert: {
          created_at?: string
          product_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Update: {
          created_at?: string
          product_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Relationships: []
      }
      meat_factory_approval_audit: {
        Row: {
          attempted_at: string
          attempted_by: string | null
          batch_id: string
          batch_number: string | null
          error_message: string | null
          id: string
          impact: Json | null
          materials_cost: number | null
          outcome: string
          planned_qty: number | null
          product_code: string | null
          product_name_ar: string | null
          scale: number | null
          shortages: Json | null
        }
        Insert: {
          attempted_at?: string
          attempted_by?: string | null
          batch_id: string
          batch_number?: string | null
          error_message?: string | null
          id?: string
          impact?: Json | null
          materials_cost?: number | null
          outcome: string
          planned_qty?: number | null
          product_code?: string | null
          product_name_ar?: string | null
          scale?: number | null
          shortages?: Json | null
        }
        Update: {
          attempted_at?: string
          attempted_by?: string | null
          batch_id?: string
          batch_number?: string | null
          error_message?: string | null
          id?: string
          impact?: Json | null
          materials_cost?: number | null
          outcome?: string
          planned_qty?: number | null
          product_code?: string | null
          product_name_ar?: string | null
          scale?: number | null
          shortages?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "meat_factory_approval_audit_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "meat_factory_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      meat_factory_batch_consumption: {
        Row: {
          batch_id: string
          created_at: string
          id: string
          line_total: number
          material_code: string
          material_name_ar: string | null
          quantity: number
          unit: string
          unit_cost: number
        }
        Insert: {
          batch_id: string
          created_at?: string
          id?: string
          line_total?: number
          material_code: string
          material_name_ar?: string | null
          quantity: number
          unit: string
          unit_cost?: number
        }
        Update: {
          batch_id?: string
          created_at?: string
          id?: string
          line_total?: number
          material_code?: string
          material_name_ar?: string | null
          quantity?: number
          unit?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "meat_factory_batch_consumption_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "meat_factory_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      meat_factory_batches: {
        Row: {
          actual_qty: number | null
          batch_number: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          expiry_date: string | null
          id: string
          labor_cost: number
          materials_cost: number
          notes: string | null
          planned_qty: number
          product_code: string
          product_name_ar: string | null
          production_date: string
          quality_notes: string | null
          quality_status: string
          source_invoice_no: number | null
          started_at: string | null
          status: string
          total_cost: number
          unit: string
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          actual_qty?: number | null
          batch_number: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          expiry_date?: string | null
          id?: string
          labor_cost?: number
          materials_cost?: number
          notes?: string | null
          planned_qty?: number
          product_code: string
          product_name_ar?: string | null
          production_date?: string
          quality_notes?: string | null
          quality_status?: string
          source_invoice_no?: number | null
          started_at?: string | null
          status?: string
          total_cost?: number
          unit?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          actual_qty?: number | null
          batch_number?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          expiry_date?: string | null
          id?: string
          labor_cost?: number
          materials_cost?: number
          notes?: string | null
          planned_qty?: number
          product_code?: string
          product_name_ar?: string | null
          production_date?: string
          quality_notes?: string | null
          quality_status?: string
          source_invoice_no?: number | null
          started_at?: string | null
          status?: string
          total_cost?: number
          unit?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      meat_factory_invoices: {
        Row: {
          created_at: string
          id: string
          input_total: number | null
          invoice_date: string | null
          invoice_no: number
          labor_total: number | null
          notes: string | null
          output_qty: number | null
          output_total: number | null
          output_unit: string | null
          product_code: string | null
          product_name_ar: string | null
          source_document: string | null
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          input_total?: number | null
          invoice_date?: string | null
          invoice_no: number
          labor_total?: number | null
          notes?: string | null
          output_qty?: number | null
          output_total?: number | null
          output_unit?: string | null
          product_code?: string | null
          product_name_ar?: string | null
          source_document?: string | null
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          input_total?: number | null
          invoice_date?: string | null
          invoice_no?: number
          labor_total?: number | null
          notes?: string | null
          output_qty?: number | null
          output_total?: number | null
          output_unit?: string | null
          product_code?: string | null
          product_name_ar?: string | null
          source_document?: string | null
          unit_cost?: number | null
        }
        Relationships: []
      }
      meat_factory_products: {
        Row: {
          barcode: string | null
          base_cost_unit: string | null
          cost_per_base_unit: number | null
          cost_price: number | null
          cost_status: string | null
          created_at: string
          functional_name_ar: string | null
          functional_name_en: string | null
          id: string
          is_active: boolean
          name_ar: string
          name_en: string | null
          notes: string | null
          package_qty: number
          package_unit: string
          product_code: string | null
          sale_price: number | null
          source_date: string | null
          source_document: string | null
          source_document_no: number | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          base_cost_unit?: string | null
          cost_per_base_unit?: number | null
          cost_price?: number | null
          cost_status?: string | null
          created_at?: string
          functional_name_ar?: string | null
          functional_name_en?: string | null
          id?: string
          is_active?: boolean
          name_ar: string
          name_en?: string | null
          notes?: string | null
          package_qty?: number
          package_unit?: string
          product_code?: string | null
          sale_price?: number | null
          source_date?: string | null
          source_document?: string | null
          source_document_no?: number | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          base_cost_unit?: string | null
          cost_per_base_unit?: number | null
          cost_price?: number | null
          cost_status?: string | null
          created_at?: string
          functional_name_ar?: string | null
          functional_name_en?: string | null
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string | null
          notes?: string | null
          package_qty?: number
          package_unit?: string
          product_code?: string | null
          sale_price?: number | null
          source_date?: string | null
          source_document?: string | null
          source_document_no?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      meat_factory_quality_log: {
        Row: {
          actual_qty: number | null
          batch_id: string
          changed_at: string
          changed_by: string | null
          from_status: string | null
          id: string
          notes: string | null
          to_status: string
        }
        Insert: {
          actual_qty?: number | null
          batch_id: string
          changed_at?: string
          changed_by?: string | null
          from_status?: string | null
          id?: string
          notes?: string | null
          to_status: string
        }
        Update: {
          actual_qty?: number | null
          batch_id?: string
          changed_at?: string
          changed_by?: string | null
          from_status?: string | null
          id?: string
          notes?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "meat_factory_quality_log_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "meat_factory_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      meat_factory_raw_materials: {
        Row: {
          avg_unit_cost: number
          category: string
          created_at: string
          default_unit: string
          id: string
          is_active: boolean
          low_stock_threshold: number
          material_code: string
          name_ar: string
          notes: string | null
          stock: number
          updated_at: string
        }
        Insert: {
          avg_unit_cost?: number
          category?: string
          created_at?: string
          default_unit?: string
          id?: string
          is_active?: boolean
          low_stock_threshold?: number
          material_code: string
          name_ar: string
          notes?: string | null
          stock?: number
          updated_at?: string
        }
        Update: {
          avg_unit_cost?: number
          category?: string
          created_at?: string
          default_unit?: string
          id?: string
          is_active?: boolean
          low_stock_threshold?: number
          material_code?: string
          name_ar?: string
          notes?: string | null
          stock?: number
          updated_at?: string
        }
        Relationships: []
      }
      meat_factory_recipes: {
        Row: {
          created_at: string
          id: string
          invoice_date: string | null
          invoice_no: number | null
          labor_total_if_output: number | null
          line_total: number | null
          line_type: string
          material_code: string | null
          material_name_ar: string | null
          notes: string | null
          product_code: string
          product_name_ar: string | null
          quantity: number
          source_document: string | null
          unit: string
          unit_cost: number | null
          warehouse: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_date?: string | null
          invoice_no?: number | null
          labor_total_if_output?: number | null
          line_total?: number | null
          line_type?: string
          material_code?: string | null
          material_name_ar?: string | null
          notes?: string | null
          product_code: string
          product_name_ar?: string | null
          quantity: number
          source_document?: string | null
          unit: string
          unit_cost?: number | null
          warehouse?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          invoice_date?: string | null
          invoice_no?: number | null
          labor_total_if_output?: number | null
          line_total?: number | null
          line_type?: string
          material_code?: string | null
          material_name_ar?: string | null
          notes?: string | null
          product_code?: string
          product_name_ar?: string | null
          quantity?: number
          source_document?: string | null
          unit?: string
          unit_cost?: number | null
          warehouse?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          description: string
          id: string
          is_read: boolean
          order_id: string | null
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          is_read?: boolean
          order_id?: string | null
          title: string
          type?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          is_read?: boolean
          order_id?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_box_items: {
        Row: {
          created_at: string
          custom_price: number
          id: string
          is_gift: boolean
          offer_box_id: string
          product_id: string
          quantity: number
        }
        Insert: {
          created_at?: string
          custom_price: number
          id?: string
          is_gift?: boolean
          offer_box_id: string
          product_id: string
          quantity?: number
        }
        Update: {
          created_at?: string
          custom_price?: number
          id?: string
          is_gift?: boolean
          offer_box_id?: string
          product_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "offer_box_items_offer_box_id_fkey"
            columns: ["offer_box_id"]
            isOneToOne: false
            referencedRelation: "offer_boxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_box_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_boxes: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          name: string
          offer_price: number | null
          shipping_cost: number | null
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          offer_price?: number | null
          shipping_cost?: number | null
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          offer_price?: number | null
          shipping_cost?: number | null
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          is_half_kg: boolean
          offer_name: string | null
          order_id: string
          product_id: string | null
          product_name: string
          production_status: string
          quantity: number
          total_price: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_half_kg?: boolean
          offer_name?: string | null
          order_id: string
          product_id?: string | null
          product_name: string
          production_status?: string
          quantity: number
          total_price: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          is_half_kg?: boolean
          offer_name?: string | null
          order_id?: string
          product_id?: string | null
          product_name?: string
          production_status?: string
          quantity?: number
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          collection_status: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          delivered_at: string | null
          delivery_address: string | null
          delivery_fee: number
          discount: number
          id: string
          moderator: string | null
          notes: string | null
          order_number: string
          payment_method: string
          payment_status: string
          shipping_company: string | null
          source: string | null
          status: string
          subtotal: number
          total: number
          total_at_delivery: number | null
          updated_at: string
        }
        Insert: {
          collection_status?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivered_at?: string | null
          delivery_address?: string | null
          delivery_fee?: number
          discount?: number
          id?: string
          moderator?: string | null
          notes?: string | null
          order_number: string
          payment_method?: string
          payment_status?: string
          shipping_company?: string | null
          source?: string | null
          status?: string
          subtotal?: number
          total?: number
          total_at_delivery?: number | null
          updated_at?: string
        }
        Update: {
          collection_status?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivered_at?: string | null
          delivery_address?: string | null
          delivery_fee?: number
          discount?: number
          id?: string
          moderator?: string | null
          notes?: string | null
          order_number?: string
          payment_method?: string
          payment_status?: string
          shipping_company?: string | null
          source?: string | null
          status?: string
          subtotal?: number
          total?: number
          total_at_delivery?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_bonus_overrides: {
        Row: {
          bone_bonus: number | null
          bone_rate: number | null
          created_at: string
          id: string
          meat_bonus: number | null
          meat_rate: number | null
          moderator_name: string
          month: number
          processed_bonus: number | null
          processed_rate: number | null
          updated_at: string
          year: number
        }
        Insert: {
          bone_bonus?: number | null
          bone_rate?: number | null
          created_at?: string
          id?: string
          meat_bonus?: number | null
          meat_rate?: number | null
          moderator_name: string
          month: number
          processed_bonus?: number | null
          processed_rate?: number | null
          updated_at?: string
          year: number
        }
        Update: {
          bone_bonus?: number | null
          bone_rate?: number | null
          created_at?: string
          id?: string
          meat_bonus?: number | null
          meat_rate?: number | null
          moderator_name?: string
          month?: number
          processed_bonus?: number | null
          processed_rate?: number | null
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      private_delivery_pricing: {
        Row: {
          created_at: string
          governorate: string | null
          id: string
          location: string
          notes: string | null
          price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          governorate?: string | null
          id?: string
          location: string
          notes?: string | null
          price?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          governorate?: string | null
          id?: string
          location?: string
          notes?: string | null
          price?: number
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          barcode: string | null
          category: string | null
          cost_price: number
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          low_stock_threshold: number
          name: string
          old_price: number | null
          price: number
          stock: number
          unit: string
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          category?: string | null
          cost_price?: number
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          low_stock_threshold?: number
          name: string
          old_price?: number | null
          price: number
          stock?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          category?: string | null
          cost_price?: number
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          low_stock_threshold?: number
          name?: string
          old_price?: number | null
          price?: number
          stock?: number
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      sales_targets: {
        Row: {
          achieved_amount: number
          created_at: string
          id: string
          month: number
          target_amount: number
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          achieved_amount?: number
          created_at?: string
          id?: string
          month: number
          target_amount?: number
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          achieved_amount?: number
          created_at?: string
          id?: string
          month?: number
          target_amount?: number
          updated_at?: string
          user_id?: string
          year?: number
        }
        Relationships: []
      }
      slaughter_audit_log: {
        Row: {
          action: string
          batch_id: string | null
          id: string
          new_value: Json | null
          notes: string | null
          old_value: Json | null
          performed_at: string
          performed_by: string | null
          target_id: string | null
          target_type: string
          transfer_id: string | null
        }
        Insert: {
          action: string
          batch_id?: string | null
          id?: string
          new_value?: Json | null
          notes?: string | null
          old_value?: Json | null
          performed_at?: string
          performed_by?: string | null
          target_id?: string | null
          target_type: string
          transfer_id?: string | null
        }
        Update: {
          action?: string
          batch_id?: string | null
          id?: string
          new_value?: Json | null
          notes?: string | null
          old_value?: Json | null
          performed_at?: string
          performed_by?: string | null
          target_id?: string | null
          target_type?: string
          transfer_id?: string | null
        }
        Relationships: []
      }
      slaughter_batch_outputs: {
        Row: {
          actual_weight_kg: number
          barcode: string | null
          batch_id: string
          branch_id: string | null
          created_at: string
          cut_name_ar: string
          destination: string
          expiry_date: string | null
          id: string
          notes: string | null
          package_count: number
          product_id: string | null
          standard_weight_kg: number
          total_cost: number | null
          unit_cost: number
          unit_price: number
          variance_kg: number | null
          variance_pct: number | null
          yield_standard_id: string | null
        }
        Insert: {
          actual_weight_kg?: number
          barcode?: string | null
          batch_id: string
          branch_id?: string | null
          created_at?: string
          cut_name_ar: string
          destination?: string
          expiry_date?: string | null
          id?: string
          notes?: string | null
          package_count?: number
          product_id?: string | null
          standard_weight_kg?: number
          total_cost?: number | null
          unit_cost?: number
          unit_price?: number
          variance_kg?: number | null
          variance_pct?: number | null
          yield_standard_id?: string | null
        }
        Update: {
          actual_weight_kg?: number
          barcode?: string | null
          batch_id?: string
          branch_id?: string | null
          created_at?: string
          cut_name_ar?: string
          destination?: string
          expiry_date?: string | null
          id?: string
          notes?: string | null
          package_count?: number
          product_id?: string | null
          standard_weight_kg?: number
          total_cost?: number | null
          unit_cost?: number
          unit_price?: number
          variance_kg?: number | null
          variance_pct?: number | null
          yield_standard_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "slaughter_batch_outputs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "slaughter_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slaughter_batch_outputs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slaughter_batch_outputs_yield_standard_id_fkey"
            columns: ["yield_standard_id"]
            isOneToOne: false
            referencedRelation: "slaughter_yield_standards"
            referencedColumns: ["id"]
          },
        ]
      }
      slaughter_batches: {
        Row: {
          actual_yield_pct: number | null
          batch_number: string
          birds_slaughtered: number
          cost_per_kg_meat: number
          created_at: string
          created_by: string | null
          end_time: string | null
          id: string
          live_receipt_id: string | null
          notes: string | null
          pre_slaughter_dead: number
          rejected_birds: number
          shift: string
          slaughter_date: string
          start_time: string | null
          status: string
          total_live_weight_kg: number
          total_meat_kg: number
          total_waste_kg: number
          updated_at: string
        }
        Insert: {
          actual_yield_pct?: number | null
          batch_number: string
          birds_slaughtered?: number
          cost_per_kg_meat?: number
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          id?: string
          live_receipt_id?: string | null
          notes?: string | null
          pre_slaughter_dead?: number
          rejected_birds?: number
          shift?: string
          slaughter_date?: string
          start_time?: string | null
          status?: string
          total_live_weight_kg?: number
          total_meat_kg?: number
          total_waste_kg?: number
          updated_at?: string
        }
        Update: {
          actual_yield_pct?: number | null
          batch_number?: string
          birds_slaughtered?: number
          cost_per_kg_meat?: number
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          id?: string
          live_receipt_id?: string | null
          notes?: string | null
          pre_slaughter_dead?: number
          rejected_birds?: number
          shift?: string
          slaughter_date?: string
          start_time?: string | null
          status?: string
          total_live_weight_kg?: number
          total_meat_kg?: number
          total_waste_kg?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slaughter_batches_live_receipt_id_fkey"
            columns: ["live_receipt_id"]
            isOneToOne: false
            referencedRelation: "slaughter_live_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      slaughter_branch_transfers: {
        Row: {
          batch_id: string
          branch_id: string
          created_at: string
          cut_name_ar: string
          id: string
          notes: string | null
          output_id: string | null
          received_by: string | null
          status: string
          total_value: number | null
          transferred_at: string
          unit_price: number
          weight_kg: number
        }
        Insert: {
          batch_id: string
          branch_id: string
          created_at?: string
          cut_name_ar: string
          id?: string
          notes?: string | null
          output_id?: string | null
          received_by?: string | null
          status?: string
          total_value?: number | null
          transferred_at?: string
          unit_price?: number
          weight_kg?: number
        }
        Update: {
          batch_id?: string
          branch_id?: string
          created_at?: string
          cut_name_ar?: string
          id?: string
          notes?: string | null
          output_id?: string | null
          received_by?: string | null
          status?: string
          total_value?: number | null
          transferred_at?: string
          unit_price?: number
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "slaughter_branch_transfers_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "slaughter_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slaughter_branch_transfers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slaughter_branch_transfers_output_id_fkey"
            columns: ["output_id"]
            isOneToOne: false
            referencedRelation: "slaughter_batch_outputs"
            referencedColumns: ["id"]
          },
        ]
      }
      slaughter_live_birds: {
        Row: {
          bird_index: number
          created_at: string
          feed_cost: number
          id: string
          live_weight_kg: number
          notes: string | null
          purchase_cost: number
          purchase_time: string | null
          receipt_id: string
          slaughter_weight_kg: number
        }
        Insert: {
          bird_index: number
          created_at?: string
          feed_cost?: number
          id?: string
          live_weight_kg?: number
          notes?: string | null
          purchase_cost?: number
          purchase_time?: string | null
          receipt_id: string
          slaughter_weight_kg?: number
        }
        Update: {
          bird_index?: number
          created_at?: string
          feed_cost?: number
          id?: string
          live_weight_kg?: number
          notes?: string | null
          purchase_cost?: number
          purchase_time?: string | null
          receipt_id?: string
          slaughter_weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "slaughter_live_birds_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "slaughter_live_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      slaughter_live_receipts: {
        Row: {
          avg_age_days: number | null
          avg_weight_kg: number | null
          bird_count: number
          created_at: string
          created_by: string | null
          dead_on_arrival: number
          farm_transfer_id: string | null
          id: string
          notes: string | null
          price_per_kg: number
          receipt_date: string
          receipt_number: string
          source_name: string | null
          source_type: string
          status: string
          total_cost: number | null
          total_weight_kg: number
          updated_at: string
          vet_check_passed: boolean
          vet_notes: string | null
        }
        Insert: {
          avg_age_days?: number | null
          avg_weight_kg?: number | null
          bird_count?: number
          created_at?: string
          created_by?: string | null
          dead_on_arrival?: number
          farm_transfer_id?: string | null
          id?: string
          notes?: string | null
          price_per_kg?: number
          receipt_date?: string
          receipt_number: string
          source_name?: string | null
          source_type?: string
          status?: string
          total_cost?: number | null
          total_weight_kg?: number
          updated_at?: string
          vet_check_passed?: boolean
          vet_notes?: string | null
        }
        Update: {
          avg_age_days?: number | null
          avg_weight_kg?: number | null
          bird_count?: number
          created_at?: string
          created_by?: string | null
          dead_on_arrival?: number
          farm_transfer_id?: string | null
          id?: string
          notes?: string | null
          price_per_kg?: number
          receipt_date?: string
          receipt_number?: string
          source_name?: string | null
          source_type?: string
          status?: string
          total_cost?: number | null
          total_weight_kg?: number
          updated_at?: string
          vet_check_passed?: boolean
          vet_notes?: string | null
        }
        Relationships: []
      }
      slaughter_quality_checks: {
        Row: {
          check_date: string
          check_type: string
          corrective_action: string | null
          created_at: string
          created_by: string | null
          id: string
          inspector_name: string
          microbiological_result: string | null
          notes: string | null
          ph_level: number | null
          related_batch_id: string | null
          related_receipt_id: string | null
          result: string
          temperature_c: number | null
          visual_inspection: string | null
        }
        Insert: {
          check_date?: string
          check_type?: string
          corrective_action?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          inspector_name: string
          microbiological_result?: string | null
          notes?: string | null
          ph_level?: number | null
          related_batch_id?: string | null
          related_receipt_id?: string | null
          result?: string
          temperature_c?: number | null
          visual_inspection?: string | null
        }
        Update: {
          check_date?: string
          check_type?: string
          corrective_action?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          inspector_name?: string
          microbiological_result?: string | null
          notes?: string | null
          ph_level?: number | null
          related_batch_id?: string | null
          related_receipt_id?: string | null
          result?: string
          temperature_c?: number | null
          visual_inspection?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "slaughter_quality_checks_related_batch_id_fkey"
            columns: ["related_batch_id"]
            isOneToOne: false
            referencedRelation: "slaughter_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slaughter_quality_checks_related_receipt_id_fkey"
            columns: ["related_receipt_id"]
            isOneToOne: false
            referencedRelation: "slaughter_live_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      slaughter_settings: {
        Row: {
          created_at: string
          id: string
          low_yield_threshold: number
          notify_on_low_yield: boolean
          updated_at: string
          updated_by: string | null
          warning_yield_threshold: number
        }
        Insert: {
          created_at?: string
          id?: string
          low_yield_threshold?: number
          notify_on_low_yield?: boolean
          updated_at?: string
          updated_by?: string | null
          warning_yield_threshold?: number
        }
        Update: {
          created_at?: string
          id?: string
          low_yield_threshold?: number
          notify_on_low_yield?: boolean
          updated_at?: string
          updated_by?: string | null
          warning_yield_threshold?: number
        }
        Relationships: []
      }
      slaughter_worker_logs: {
        Row: {
          batch_id: string | null
          birds_processed: number
          created_at: string
          hours_worked: number
          id: string
          log_date: string
          notes: string | null
          performance_rating: number | null
          worker_id: string
        }
        Insert: {
          batch_id?: string | null
          birds_processed?: number
          created_at?: string
          hours_worked?: number
          id?: string
          log_date?: string
          notes?: string | null
          performance_rating?: number | null
          worker_id: string
        }
        Update: {
          batch_id?: string | null
          birds_processed?: number
          created_at?: string
          hours_worked?: number
          id?: string
          log_date?: string
          notes?: string | null
          performance_rating?: number | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "slaughter_worker_logs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "slaughter_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slaughter_worker_logs_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "slaughter_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      slaughter_workers: {
        Row: {
          created_at: string
          daily_wage: number
          full_name: string
          hire_date: string | null
          id: string
          is_active: boolean
          national_id: string | null
          notes: string | null
          phone: string | null
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_wage?: number
          full_name: string
          hire_date?: string | null
          id?: string
          is_active?: boolean
          national_id?: string | null
          notes?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_wage?: number
          full_name?: string
          hire_date?: string | null
          id?: string
          is_active?: boolean
          national_id?: string | null
          notes?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      slaughter_yield_standards: {
        Row: {
          barcode: string | null
          category: string | null
          created_at: string
          cut_name_ar: string
          cut_name_en: string | null
          display_order: number
          id: string
          is_active: boolean
          material_code: string | null
          notes: string | null
          package_size_kg: number | null
          price_per_kg: number | null
          product_id: string | null
          standard_yield_pct: number
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          category?: string | null
          created_at?: string
          cut_name_ar: string
          cut_name_en?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          material_code?: string | null
          notes?: string | null
          package_size_kg?: number | null
          price_per_kg?: number | null
          product_id?: string | null
          standard_yield_pct?: number
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          category?: string | null
          created_at?: string
          cut_name_ar?: string
          cut_name_en?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          material_code?: string | null
          notes?: string | null
          package_size_kg?: number | null
          price_per_kg?: number | null
          product_id?: string | null
          standard_yield_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      stock_replenishment_log: {
        Row: {
          created_at: string
          half_kg_bags: number
          id: string
          kg_bags: number
          new_stock: number
          notes: string | null
          performed_by: string | null
          performed_by_name: string | null
          previous_stock: number
          product_id: string
          product_name: string
          quantity_added: number
          supplier_reference: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          half_kg_bags?: number
          id?: string
          kg_bags?: number
          new_stock: number
          notes?: string | null
          performed_by?: string | null
          performed_by_name?: string | null
          previous_stock?: number
          product_id: string
          product_name: string
          quantity_added: number
          supplier_reference?: string | null
          unit_price?: number
        }
        Update: {
          created_at?: string
          half_kg_bags?: number
          id?: string
          kg_bags?: number
          new_stock?: number
          notes?: string | null
          performed_by?: string | null
          performed_by_name?: string | null
          previous_stock?: number
          product_id?: string
          product_name?: string
          quantity_added?: number
          supplier_reference?: string | null
          unit_price?: number
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      target_bonus_settings: {
        Row: {
          bonus_amount: number
          category: string
          created_at: string
          id: string
          sales_amount: number
          tier: number
          updated_at: string
        }
        Insert: {
          bonus_amount?: number
          category: string
          created_at?: string
          id?: string
          sales_amount?: number
          tier: number
          updated_at?: string
        }
        Update: {
          bonus_amount?: number
          category?: string
          created_at?: string
          id?: string
          sales_amount?: number
          tier?: number
          updated_at?: string
        }
        Relationships: []
      }
      team_assignments: {
        Row: {
          created_at: string
          id: string
          manager_id: string
          moderator_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          manager_id: string
          moderator_id: string
        }
        Update: {
          created_at?: string
          id?: string
          manager_id?: string
          moderator_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      warehouses: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          location: string | null
          manager_id: string | null
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          manager_id?: string | null
          name: string
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          manager_id?: string | null
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_meat_factory_batch: {
        Args: { p_batch_id: string }
        Returns: Json
      }
      can_add_products: { Args: { _user_id: string }; Returns: boolean }
      can_edit_product_price: { Args: { _user_id: string }; Returns: boolean }
      check_offer_expiry: { Args: never; Returns: boolean }
      deactivate_expired_offers: { Args: never; Returns: undefined }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      finalize_slaughter_batch: { Args: { p_batch_id: string }; Returns: Json }
      generate_order_number: { Args: never; Returns: string }
      get_dashboard_overview: { Args: never; Returns: Json }
      get_production_dashboard: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      preview_meat_factory_batch_requirements: {
        Args: { p_batch_id: string }
        Returns: Json
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      slaughter_daily_summary: { Args: { p_date: string }; Returns: Json }
    }
    Enums: {
      app_role:
        | "general_manager"
        | "executive_manager"
        | "sales_moderator"
        | "accountant"
        | "warehouse_supervisor"
        | "sales_manager"
        | "farm_manager"
        | "hatchery_manager"
        | "brooding_manager"
        | "slaughterhouse_manager"
        | "meat_factory_manager"
        | "feed_factory_manager"
        | "hr_manager"
        | "production_manager"
        | "marketing_sales_manager"
        | "financial_manager"
        | "quality_manager"
        | "shipping_company"
        | "catering_sales_b2c"
        | "catering_sales_b2b"
        | "kitchen_manager"
        | "pastry_chef"
        | "dessert_chef"
        | "hot_food_chef"
        | "salad_chef"
        | "procurement_manager"
        | "cost_accountant"
        | "private_delivery_rep"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "general_manager",
        "executive_manager",
        "sales_moderator",
        "accountant",
        "warehouse_supervisor",
        "sales_manager",
        "farm_manager",
        "hatchery_manager",
        "brooding_manager",
        "slaughterhouse_manager",
        "meat_factory_manager",
        "feed_factory_manager",
        "hr_manager",
        "production_manager",
        "marketing_sales_manager",
        "financial_manager",
        "quality_manager",
        "shipping_company",
        "catering_sales_b2c",
        "catering_sales_b2b",
        "kitchen_manager",
        "pastry_chef",
        "dessert_chef",
        "hot_food_chef",
        "salad_chef",
        "procurement_manager",
        "cost_accountant",
        "private_delivery_rep",
      ],
    },
  },
} as const
