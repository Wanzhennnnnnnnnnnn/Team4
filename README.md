# Team4
```mermaid
flowchart TD
    A[BuildLink]

    %% --- HS's Work ---
    A --> C("Auth<br><b>Shing.Rong.LEE</b>")
    C --> C1("Register/Login (Contractor)")
    C --> C2("Register/Login (Supplier)")
    
    A --> F("Data Dashboard<br><b>Shing.Rong.LEE</b>")
    F --> F1(Monitor Multi-Project Dashboard)
    F --> F2(View Analytics Reports)

    %% --- LEE's Work' ---
    A --> B("Contractor Function<br><b>Wan.Zhen.HSU</b>")
    B --> D("Procurement Management")
    D --> D1(Manage Supplier)
    D --> D2(Create Purchase Order)
    
    B --> E("Delivery tracking")
    E --> E1(Track Delivery)

    B --> F_Sub("Accounting Management")
    F_Sub --> F_Sub1(Manage Invoices)


    %% --- Zafran's Work ---
    A --> G("Supplier Function<br><b>Zhafran</b>")
    G --> I("Supply Chain Management")
    I --> I1(Update Material)
    I --> I2(Confirm Purchase Order)
    
    G --> J("Delivery Management")
    J --> J1(Provide Delivery)
    
    G --> K("Accounting Management")
    K --> K1(Send Invoices)


    %% --- 顏色定義 (實作優先權) ---
    
    %% MVP (高優先) - 綠色
    classDef highPriority fill:#81C59E,stroke:#333,stroke-width:2px;
    %% Full-Featured (低優先) - 藍色
    classDef lowPriority fill:#ACD6FF,stroke:#333,stroke-width:2px;

    %% --- 應用顏色 ---
    class C,C1,C2,D,D1,D2,E,E1,I,I1,I2,J,J1 highPriority
    class F,F1,F2,F_Sub,F_Sub1,K,K1 lowPriority
   ```
