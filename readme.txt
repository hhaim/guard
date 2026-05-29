3) notions of days per slot , per slot mask of types (advanced)


python3 guard_scheduler_sim.py -x 12 -y 4 -d 1 --seed 42 --min-consecutive-free-hours 6 --zones zones_s1.yaml --min-free-shifts-after-duty 2


python3 guard_scheduler_sim.py -x 18 -y 5 -d 1 --seed 42 --min-consecutive-free-hours 6 
--zones zones_s2.yaml --min-free-shifts-after-duty 2 --roaster roaster1.yaml 

================

* review the changes why there are so many, did we found a bug or it is a RND issue?
* commit the test verify that it works and uses the same input json 
* verify future 9-9 with future blocks is OK

1. another test simple 12/4
2. add a test that verify from the results that constraint are meet 
3. verify that simulation json and what we save is the same need to have the same function same engine 
