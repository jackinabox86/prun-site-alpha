# Glossary

- **Ticker**  
  Unique identifier for a material (e.g., C, H, PE, PCB, SEN, SAR).

- **RecipeID**  
  ID for a specific recipe that produces a given ticker.

- **Scenario**  
  A sourcing path for a ticker:
  - Which recipe is used.
  - Which inputs are bought or made.
  - Recursively includes child inputs.

- **Option / MakeOption**  
  One possible production or sourcing option for a ticker.

- **BestRecipeIDs**  
  Sheet + cache mapping each ticker → best recipe/scenario by Profit/Area.

- **Profit/Area (P/A)**  
  Profit per unit of production area, normalized across recipes. Key ranking metric.

- **Stage Profit/Day**  
  Profit from running a stage at full daily capacity.

- **Adjusted Area (per day)**  
  Area scaled to the actual demand for that stage.

- **Total Area (per day)**  
  Capacity-based area denominator: own area + normalized children area.

- **Control Panel**  
  Sheet (and eventually UI) where user chooses:
  - Ticker to analyze.
  - Bid vs Ask toggle.
