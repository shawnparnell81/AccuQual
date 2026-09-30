# AccuQual UI / UX

Living notes for what a person can do in the app. Keep this current until the app build is nearly complete.

This page describes the Documents filing cabinet and how a filled form is saved and found again. Other modules keep their own screens. NCR, CAPA, and 8D are unchanged.

## Folder Explorer

Open it from **Quality → Document Control → Folder Explorer**.

What you can do:

- See the departments down the left side.
- Click a department to work with its folders. **Open** on a department or folder switches to that folder's contents.
- The path at the top is the breadcrumb (Documents / department / folder). Each earlier part of the path opens that folder. **Up** goes to the parent.
- The list shows subfolders and files in the folder you opened. Click a subfolder to go inside it. Click a saved form to open that record in the app.
- **Upload Document**, or drop a file on the folder, adds a file in that folder.
- **+ Add folder** creates a folder inside the one you are viewing. **+ Add department** creates a top-level folder.
- Drag a folder onto another folder to move it, with everything inside it. Drop a folder on **Top level** to make it a department. Drag a file onto a folder to move the file. Drop a file on **Library Pool** to take it out of its folder.
- The sidebar (the main menu) can still be rearranged by an administrator with drag and drop. That does not change these Documents folders.

A folder link looks like Folder Explorer with `?folder=` set to that folder. That is the same screen **Open folder** uses after a save.

## Save a filled form into a folder

On CSA Validation (FRM-VAL-001), Fuel Pump Validation (FRM-VAL-007), and the other forms that show **Save to folder**:

1. Fill in the form.
2. Choose the Documents folder under **Save to folder**. The suggested folder is selected when it exists. Clear the choice if you do not want it filed yet.
3. Click **Save**.
4. Read the line **Saved in …**. The path is clickable. **Open folder** opens that folder in Folder Explorer.
5. In the folder, click the form's name. It opens the same record.

**Move** sends that one filed copy to a different folder. There is not a second copy in the old folder.

The form is not only a download. The record stays in AccuQual, and the folder row is how you get back to it.

## Where saved files are

| You want to… | Go here |
| --- | --- |
| Open the folder you just saved into | **Open folder** on the save line, or click the path |
| Browse later | Quality → Document Control → Folder Explorer, then open the folder |
| Start another CSA or fuel pump form | Quality → Validation Reports, or the blank form in Folder Explorer |
| Open a validation record you already know | Validation Reports list, or the file row in the Documents folder you chose |

Both the Validation Reports list and the Documents folder open the same saved record.
