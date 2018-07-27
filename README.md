# ts-api

Using the typescript parser and type checker, generate a skeleton API.

* generate swagger
* generate runtime type checks
* generate express routes

## Install
    npm -g install ts-api

This will install a program cg that can be invoked later to generate source files to enable
the above features.

## Usage

### Inclue ts-api package in a project

First make this package a dependency.  This will provide the necessary decorators *@controller*,
*@router* *@get* *@post*, etc.  The analyzer will search for those names and generate code that
uses them, but these decorators also do things themselves like invoke the runtime type checker.

### Create appropriately annotated classes and methods.

### Run cg

    cg <options> <list of files>
