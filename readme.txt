3) notions of days per slot , per slot mask of types (advanced)


python3 guard_scheduler_sim.py -x 12 -y 4 -d 1 --seed 42 --min-consecutive-free-hours 6 --zones zones_s1.yaml --min-free-shifts-after-duty 2


python3 guard_scheduler_sim.py -x 18 -y 5 -d 1 --seed 42 --min-consecutive-free-hours 6 --zones zones_next_day_full.yaml --min-free-shifts-after-duty 2 --roaster roaster1.yaml 

python3 guard_scheduler_sim.py -x 18 -y 5 -d 4 --seed 42 --min-consecutive-free-hours 6 --zones zones_next_day_full.yaml --min-free-shifts-after-duty 2 --roster roaster1.yaml  

# Production-style incremental sim (per-day PlanDoc in checkpoint.json):
python3 guard_scheduler_sim.py -x 12 -y 4 -d 4 --hot --seed 42 --zones zones_s1.yaml --min-free-shifts-after-duty 2
python3 guard_scheduler_sim.py -x 12 -y 4 -d 4 --hot --burst-days 4 --seed 42 --zones zones_s1.yaml

go run ./cmd/guardsim -x 80 -y 11 -d 4 -seed 42 -min-consecutive-free-hours 6 -zones zones-dv2.yaml -min-free-shifts-after-duty 2 -roster roster-dv2.yaml -hot -anchor-date 2026-05-27
python3 guard_scheduler_sim.py -x 80 -y 11 -d 40 --seed 42 --min-consecutive-free-hours 6 --zones zones-dv2.yaml --min-free-shifts-after-duty 2 --roster roster-dv2.yaml --hot


python3 guard_scheduler_sim.py -x 79 -y 1 -d 1 --seed 42 --min-consecutive-free-hours 6 --zones-dv3.yaml --min-free-shifts-after-duty 2 --roaster roster-dv3.yaml 
python3 guard_scheduler_sim.py -x 79 -y 10 -d 1 --seed 42 --min-consecutive-free-hours 6 --zones zones-dv3.yaml --min-free-shifts-after-duty 2 --roster roster-dv3.yaml  --anchor-date 2026-06-01


================
* add daniel use-case 
* create a test 
2. add a test that verify from the results that constraint are meet 
3. verify that simulation json and what we save is the same need to have the same function same engine 

=========
deploy:
=========
more .env
fly deploy --build-arg VITE_CLERK_PUBLISHABLE_KEY='pk_...'
fly secrets set CSP_REPORT_ONLY=1

curl https://guard-scheduler.fly.dev/health
fly logs
export DATABASE_URL="$(npx -y neonctl@latest connection-string --pooled)"
./bin/guardcli users list    # should show your 2 admins

=========

* time shift range for 05:00 need to be aligned 
* fix the zones cycles, need to verify that it works 
* add id to soldiers 
* add accordion to slots 
* add color setting 