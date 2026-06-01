3) notions of days per slot , per slot mask of types (advanced)


python3 guard_scheduler_sim.py -x 12 -y 4 -d 1 --seed 42 --min-consecutive-free-hours 6 --zones zones_s1.yaml --min-free-shifts-after-duty 2


python3 guard_scheduler_sim.py -x 18 -y 5 -d 1 --seed 42 --min-consecutive-free-hours 6 --zones zones_next_day_full.yaml --min-free-shifts-after-duty 2 --roaster roaster1.yaml 

python3 guard_scheduler_sim.py -x 18 -y 5 -d 4 --seed 42 --min-consecutive-free-hours 6 --zones zones_next_day_full.yaml --min-free-shifts-after-duty 2 --roster roaster1.yaml  

# Production-style incremental sim (per-day PlanDoc in checkpoint.json):
python3 guard_scheduler_sim.py -x 12 -y 4 -d 4 --hot --seed 42 --zones zones_s1.yaml --min-free-shifts-after-duty 2
python3 guard_scheduler_sim.py -x 12 -y 4 -d 4 --hot --burst-days 4 --seed 42 --zones zones_s1.yaml


================
* add daniel use-case 
* create a test 
2. add a test that verify from the results that constraint are meet 
3. verify that simulation json and what we save is the same need to have the same function same engine 


* time shift range for 05:00 need to be aligned 
* fix the zones cycles, need to verify that it works 
* add id to soldiers 
* add accordion to slots 
* add color setting 