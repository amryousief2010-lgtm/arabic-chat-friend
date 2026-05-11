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
          id: string
          name: string
          notes: string | null
          phone: string
          total_orders: number
          total_spent: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone: string
          total_orders?: number
          total_spent?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string
          total_orders?: number
          total_spent?: number
          updated_at?: string
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
          offer_box_id: string
          product_id: string
          quantity: number
        }
        Insert: {
          created_at?: string
          custom_price: number
          id?: string
          offer_box_id: string
          product_id: string
          quantity?: number
        }
        Update: {
          created_at?: string
          custom_price?: number
          id?: string
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
          updated_at?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
          total_price: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          product_id?: string | null
          product_name: string
          quantity: number
          total_price: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string | null
          product_name?: string
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
          updated_at: string
        }
        Insert: {
          collection_status?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
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
          updated_at?: string
        }
        Update: {
          collection_status?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
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
      products: {
        Row: {
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
      can_add_products: { Args: { _user_id: string }; Returns: boolean }
      can_edit_product_price: { Args: { _user_id: string }; Returns: boolean }
      check_offer_expiry: { Args: never; Returns: boolean }
      deactivate_expired_offers: { Args: never; Returns: undefined }
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
      ],
    },
  },
} as const
