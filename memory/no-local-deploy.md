--- 
name: no-local-deploy 
description: Do not install/run/deploy the project on the current machine 
metadata: 
  type: feedback 
--- 
 
The user does not want the food-ordering project installed, run, or deployed on the current system. They will run `npm install` / `npm start` / deploy on a different machine or environment. 
 
**Why:** The current system is not the target environment; it's only used for writing the code. 
 
**How to apply:** Write and edit files as normal, but do NOT run `npm install`, start the server, or any build/run/deploy commands here. Hand off setup steps in docs instead of executing them. 
 

 
