# Team4
```mermaid
graph TD
    %% 定義樣式類別
    classDef mvp fill:#d4edda,stroke:#155724,stroke-width:2px,color:#155724;
    classDef exp fill:#cce5ff,stroke:#004085,stroke-width:2px,color:#004085;
    classDef root fill:#f8f9fa,stroke:#343a40,stroke-width:2px;
    classDef action fill:#fff3cd,stroke:#856404,stroke-width:2px,stroke-dasharray: 5 5;
    
    %% 定義「缺失/需修改」的樣式 (紅色框)
    classDef mvp_missing fill:#d4edda,stroke:#ff0000,stroke-width:4px,stroke-dasharray: 5 5,color:#d00000;
    classDef exp_missing fill:#cce5ff,stroke:#ff0000,stroke-width:4px,stroke-dasharray: 5 5,color:#d00000;

    %% Auth Branch (Completed)
    Root[Build Link]:::root --> Login("Login<br/>(Shing.Rong.Lee)"):::mvp
    Root[Build Link]:::root --> Register("Register<br/>(Shing.Rong.Lee)"):::mvp
    Root[Build Link]:::root --> ForgetPW("Forget Password<br/>(Shing.Rong.Lee)"):::mvp

    %% Login Downstream
    Login --> EditProfile("Edit Profile<br/>(Shing.Rong.Lee)"):::exp
    Login --> Dashboard("Dashboard<br/>(Wan.Zhen.HSU)"):::mvp
    Login --> Projects("Projects<br/>(Wan.Zhen.HSU)"):::mvp

    %% --- 分流入口 ---
    Login --> Suppliers("Suppliers<br/>(Wan.Zhen.HSU)"):::mvp
    Login --> Materials("Materials<br/>(Wan.Zhen.HSU)"):::mvp
    Login --> TransHistory("Transaction History<br/>(Wan.Zhen.HSU)"):::exp

    %% 新增：通知中心
    Login --> Notifications("Notification Center<br/>(Shing.Rong.Lee)"):::exp

    %% Supplier Dashboard Branch
    Login --> SupplierDashboard("Supplier Dashboard<br/>(Zhafran)"):::exp
    SupplierDashboard --> SupplierListOrders("List of Orders<br/>(Zhafran)"):::exp
    SupplierDashboard --> SupplierDetailOrders("Detail Orders<br/>(Zhafran)"):::exp
    SupplierDashboard --> SupplierMessage("Message Feature<br/>(Zhafran)"):::exp

    %% Dashboard Branch (Completed)
    Dashboard --> TotalSpend("Total Project Spend<br/>(Wan.Zhen.HSU)"):::exp
    Dashboard --> ActiveOrders("Active orders<br/>(Wan.Zhen.HSU)"):::exp
    Dashboard --> ActiveProjects("Active projects<br/>(Wan.Zhen.HSU)"):::exp
    Dashboard --> RecentOrder("Recent Orders<br/>(Wan.Zhen.HSU)"):::exp
    Dashboard --> TopSuppliers("Top Rated Suppliers<br/>(Zhafran)"):::exp

    %% History Procurement Branch
    TransHistory --> OrderDetail("Order detail<br/>(Zhafran)"):::exp
    OrderDetail -.-> Invoice

    %% Projects Branch
    Projects --> ManageProject("Manage Project<br/>(Wan.Zhen.HSU)"):::mvp
    Projects --> AddProject("Add Project<br/>(Wan.Zhen.HSU)"):::mvp

    ManageProject --> WorkItem("Work Item<br/>(Wan.Zhen.HSU)"):::mvp

    %% 專案細節流程
    WorkItem --> ItemStatus("Item Status<br/>(Wan.Zhen.HSU)"):::exp
    WorkItem --> ItemMaterial("Item Material<br/>(Wan.Zhen.HSU)"):::mvp
    ItemMaterial --> MaterialStatus("Material Status<br/>(Shing.Rong.Lee)"):::exp

    %% 專案需求 -> 找供應商
    WorkItem -- "Need Sourcing" --> PurchaseOrderReq("Purchase Request<br/>(Wan.Zhen.HSU)"):::mvp
    PurchaseOrderReq --> Suppliers

    %% --- 核心修改：搜尋與目錄邏輯分流 ---

    %% Path A: Suppliers
    Suppliers --> SupSearch("Search Suppliers<br/>(List View)<br/>(Wan.Zhen.HSU)"):::mvp
    SupSearch --> Message("Message Supplier<br/>(Zhafran)"):::exp

    SupSearch -- "Click Supplier" --> SupDetail("Supplier Detail Page<br/>(Info + Material List)<br/>(Wan.Zhen.HSU)"):::mvp
    SupDetail --> Material("Select Material & Qty<br/>(Wan.Zhen.HSU)"):::mvp

    %% Path B: Materials
    Materials --> MatSearch("Search Materials<br/>(Keyword/Category)<br/>(Wan.Zhen.HSU)"):::mvp
    MatSearch -- "Click Item" --> MatDetail("Material Detail<br/>(Info + Supplier Card)<br/>(Wan.Zhen.HSU)"):::mvp

    %% Materials 路徑的連結
    MatDetail --> Material
    MatDetail -. "View Supplier Info" .-> SupDetail

    %% 收藏功能 (缺失)
    SupDetail -- "Save Supplier" --> Wishlist("Wishlist/Favorites<br/>(Zhafran)"):::exp
    MatDetail -- "Save Material" --> Wishlist

    %% Order Configuration
    Material --> OrderConfig("Order Configuration<br/>(Wan.Zhen.HSU)"):::mvp

    %% Order & Logistics Flow
    OrderConfig --> Cart("購物車 & Order<br/>(Wan.Zhen.HSU)"):::mvp

    %% 結帳流程
    Cart --> Checkout("Checkout/Confirm<br/>(Wan.Zhen.HSU)"):::exp

    Checkout --> Logistics("物流 Status<br/>(Zhafran)"):::exp

    Logistics --> Rating("Rating<br/>(Zhafran)"):::exp

    %% 售後 (缺失)
    Logistics --> ReturnDispute("Return/Dispute<br/>(Zhafran)"):::exp

    %% Invoice (缺失)
    Logistics -.-> Invoice("Invoice<br/>(Zhafran)"):::exp

    %% 閉環回饋
    Logistics -.Status Update.-> ItemStatus
   ```
