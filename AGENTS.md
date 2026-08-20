# Vela

Vela is an app reponsible for controlling astronomy Rigs. It allows remote access and control of devices associated with the rig, typically accessed by an ALPACA API. Users will select their Rig, Plan and map out observation sessions, actively monitor sessions. In addition to Rig operation, Vela allows users to see and process oberservation artifacts in the form of FITS files.

## Repository Structure

There are boundaries of ownership between the agent and user. The user prefers to hand code most things in **User coded** areas, unless requested otherwise. The agent is responsible for most everything else. The main highlights are below.

- `apps/server` - Backend server for Vela, responsible for handling API requests, managing user sessions, and interfacing with the ALPACA API. [User coded]
- `apps/web` - Frontend web application for Vela, providing a user interface for controlling rigs, planning sessions, and viewing observation data. [User coded]
- `apps/workshop` - An app responsible for designing and maintaining components and publishing them to `packages/ui`. [Agent managed]
- `packages/ui` - A package containing reusable UI components for the Vela web application. [Agent managed]
- `packages/model` - shared model between `apps/server` and `app/web`. [User coded]
