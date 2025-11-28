-- Migration: Create Work Items Feature
-- Date: 2025-11-28
-- Description: Adds WorkItems and WorkItemMaterials tables to support work item management

-- ==========================================
-- 1. Create WorkItems Table
-- ==========================================
CREATE TABLE IF NOT EXISTS WorkItems (
  WorkItemID INT NOT NULL AUTO_INCREMENT,
  ProjectID INT NOT NULL,
  WorkItemType VARCHAR(100) NOT NULL COMMENT 'earthwork, excavation, foundation_piling, formwork, concrete_pouring, steel_fixing, scaffolding, waterproofing, drainage, finishing',
  WorkItemName VARCHAR(255) NOT NULL,
  Description TEXT,
  Status VARCHAR(50) DEFAULT 'Planning' COMMENT 'Planning, In Progress, Completed, On Hold',
  StartDate DATE,
  EndDate DATE,
  EstimatedCost DECIMAL(15,2),
  ActualCost DECIMAL(15,2) DEFAULT 0.00,
  CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (WorkItemID),
  KEY idx_project_id (ProjectID),
  KEY idx_work_item_type (WorkItemType),
  KEY idx_status (Status),
  CONSTRAINT WorkItems_ibfk_1 FOREIGN KEY (ProjectID)
    REFERENCES Projects (ProjectID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Construction work items categorized by type';

-- ==========================================
-- 2. Create WorkItemMaterials Table
-- ==========================================
CREATE TABLE IF NOT EXISTS WorkItemMaterials (
  WorkItemMaterialID INT NOT NULL AUTO_INCREMENT,
  WorkItemID INT NOT NULL,
  MaterialID VARCHAR(50) NOT NULL,
  RequiredQuantity INT NOT NULL,
  AllocatedQuantity INT DEFAULT 0,
  UnitPrice DECIMAL(10,2),
  Status VARCHAR(50) DEFAULT 'Pending' COMMENT 'Pending, Ordered, Partially_Delivered, Delivered',
  Notes TEXT,
  CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (WorkItemMaterialID),
  KEY idx_workitem_id (WorkItemID),
  KEY idx_material_id (MaterialID),
  KEY idx_status (Status),
  CONSTRAINT WorkItemMaterials_ibfk_1 FOREIGN KEY (WorkItemID)
    REFERENCES WorkItems (WorkItemID) ON DELETE CASCADE,
  CONSTRAINT WorkItemMaterials_ibfk_2 FOREIGN KEY (MaterialID)
    REFERENCES Materials (MaterialID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Materials required for each work item with allocation tracking';

-- ==========================================
-- 3. Alter PurchaseOrder Table
-- ==========================================
-- Add WorkItemID column to link purchase orders to specific work items
ALTER TABLE PurchaseOrder
  ADD COLUMN IF NOT EXISTS WorkItemID INT DEFAULT NULL AFTER ProjectID,
  ADD KEY IF NOT EXISTS idx_workitem_id (WorkItemID),
  ADD CONSTRAINT IF NOT EXISTS PurchaseOrder_ibfk_4 FOREIGN KEY (WorkItemID)
    REFERENCES WorkItems (WorkItemID) ON DELETE SET NULL;

-- ==========================================
-- Notes:
-- ==========================================
-- 1. WorkItemID in PurchaseOrder is optional (NULL) for backward compatibility
-- 2. Cascading deletes ensure data integrity when projects or work items are removed
-- 3. SET NULL on PurchaseOrder preserves order history even if work item is deleted
-- 4. Indexes added for frequently queried fields to optimize performance
