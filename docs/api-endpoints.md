[![YNAB Logo](https://api.ynab.com/papi/logo_api_meadow.svg)](https://api.ynab.com/)

- [Documentation](https://api.ynab.com/)
- [Endpoints](https://api.ynab.com/v1)
- [Status](https://ynabstatus.com/)
- [YNAB App](https://app.ynab.com/)

- Introduction

- User

Close Group


  - Get user
    HTTP Method:  GET
- Plans

Close Group


  - Get all plans
    HTTP Method:  GET
  - Get a plan
    HTTP Method:  GET
  - Get plan settings
    HTTP Method:  GET
- Accounts

Close Group


  - Get all accounts
    HTTP Method:  GET
  - Create an account
    HTTP Method:  POST
  - Get an account
    HTTP Method:  GET
- Categories

Close Group


  - Get all categories
    HTTP Method:  GET
  - Create a category
    HTTP Method:  POST
  - Get a category
    HTTP Method:  GET
  - Update a category
    HTTP Method:  PATCH
  - Get a category for a specific plan month
    HTTP Method:  GET
  - Update a category for a specific month
    HTTP Method:  PATCH
  - Create a category group
    HTTP Method:  POST
  - Update a category group
    HTTP Method:  PATCH
- Payees

Close Group


  - Get all payees
    HTTP Method:  GET
  - Get a payee
    HTTP Method:  GET
  - Update a payee
    HTTP Method:  PATCH
- Payee Locations

Close Group


  - Get all payee locations
    HTTP Method:  GET
  - Get a payee location
    HTTP Method:  GET
  - Get all locations for a payee
    HTTP Method:  GET
- Months

Close Group


  - Get all plan months
    HTTP Method:  GET
  - Get a plan month
    HTTP Method:  GET
- Money Movements

Close Group


  - Get all money movements
    HTTP Method:  GET
  - Get money movements for a plan month
    HTTP Method:  GET
  - Get all money movement groups
    HTTP Method:  GET
  - Get money movement groups for a plan month
    HTTP Method:  GET
- Transactions

Close Group


  - Get all transactions
    HTTP Method:  GET
  - Create a single transaction or multiple transactions
    HTTP Method:  POST
  - Update multiple transactions
    HTTP Method:  PATCH
  - Import transactions
    HTTP Method:  POST
  - Get a transaction
    HTTP Method:  GET
  - Update a transaction
    HTTP Method:  PUT
  - Delete a transaction
    HTTP Method:  DEL
  - Get all account transactions
    HTTP Method:  GET
  - Get all category transactions
    HTTP Method:  GET
  - Get all payee transactions
    HTTP Method:  GET
  - Get all plan month transactions
    HTTP Method:  GET
- Scheduled Transactions

Close Group


  - Get all scheduled transactions
    HTTP Method:  GET
  - Create a scheduled transaction
    HTTP Method:  POST
  - Get a scheduled transaction
    HTTP Method:  GET
  - Update a scheduled transaction
    HTTP Method:  PUT
  - Delete a scheduled transaction
    HTTP Method:  DEL

[Powered by Scalar](https://www.scalar.com/)

v1.79.0

OAS 3.1.1

# YNAB API Endpoints

Download OpenAPI Document
json
Download OpenAPI Document
yaml

Our API uses a REST based design, leverages the JSON data format, and relies upon HTTPS for transport. We respond with meaningful HTTP response codes and if an error occurs, we include error details in the response body. API Documentation is at [https://api.ynab.com](https://api.ynab.com/)

Server

Server:https://api.ynab.com/v1

## AuthenticationRequired

Selected Auth Type: bearer

|     |
| --- |
| Bearer Token : <br>Show Password |

Client Libraries

Shell

More Select from all clients

Shell Curl

## User

​Copy link

User Operations

- get/user

### Get user

​Copy link

Returns authenticated user information

Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


Request Example for get/user

Shell Curl

```curl
curl https://api.ynab.com/v1/user \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /user)

Status: 200

Show Schema

```json
{
  "data": {
    "user": {
      "id": "123e4567-e89b-12d3-a456-426614174000"
    }
  }
}
```

JSONCopy

JSONCopy

The user info

## Plans

​Copy link

Plans Operations

- get/plans
- get/plans/{plan\_id}
- get/plans/{plan\_id}/settings

### Get all plans

​Copy link

Returns plans list with summary information

Query Parameters

- include\_accountsCopy link to include\_accounts



Type: boolean







Whether to include the list of plan accounts


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans

Shell Curl

```curl
curl https://api.ynab.com/v1/plans \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "plans": [\
      {\
        "id": "123e4567-e89b-12d3-a456-426614174000",\
        "name": "string",\
        "last_modified_on": "2026-03-20T16:15:04.325Z",\
        "first_month": "2026-03-20",\
        "last_month": "2026-03-20",\
        "date_format": {\
          "format": "string"\
        },\
        "currency_format": {\
          "iso_code": "string",\
          "example_format": "string",\
          "decimal_digits": 1,\
          "decimal_separator": "string",\
          "symbol_first": true,\
          "group_separator": "string",\
          "currency_symbol": "string",\
          "display_symbol": true\
        },\
        "accounts": [\
          {\
            "id": "123e4567-e89b-12d3-a456-426614174000",\
            "name": "string",\
            "type": "checking",\
            "on_budget": true,\
            "closed": true,\
            "note": null,\
            "balance": 1,\
            "cleared_balance": 1,\
            "uncleared_balance": 1,\
            "transfer_payee_id": null,\
            "...": "[Additional Properties Truncated]"\
          }\
        ]\
      }\
    ],
    "default_plan": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "string",
      "last_modified_on": "2026-03-20T16:15:04.325Z",
      "first_month": "2026-03-20",
      "last_month": "2026-03-20",
      "date_format": {
        "format": "string"
      },
      "currency_format": {
        "iso_code": "string",
        "example_format": "string",
        "decimal_digits": 1,
        "decimal_separator": "string",
        "symbol_first": true,
        "group_separator": "string",
        "currency_symbol": "string",
        "display_symbol": true
      },
      "accounts": [\
        {\
          "id": "123e4567-e89b-12d3-a456-426614174000",\
          "name": "string",\
          "type": "checking",\
          "on_budget": true,\
          "closed": true,\
          "note": null,\
          "balance": 1,\
          "cleared_balance": 1,\
          "uncleared_balance": 1,\
          "transfer_payee_id": null,\
          "...": "[Additional Properties Truncated]"\
        }\
      ]
    }
  }
}
```

JSONCopy

JSONCopy

The list of plans

### Get a plan

​Copy link

Returns a single plan with all related entities. This resource is effectively a full plan export.

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).


Query Parameters

- last\_knowledge\_of\_serverCopy link to last\_knowledge\_of\_server



Type: integerFormat: int64







The starting server knowledge. If provided, only entities that have changed since `last_knowledge_of_server` will be included.


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id})

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "plan": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "string",
      "last_modified_on": "2026-03-20T16:15:04.325Z",
      "first_month": "2026-03-20",
      "last_month": "2026-03-20",
      "date_format": {
        "format": "string"
      },
      "currency_format": {
        "iso_code": "string",
        "example_format": "string",
        "decimal_digits": 1,
        "decimal_separator": "string",
        "symbol_first": true,
        "group_separator": "string",
        "currency_symbol": "string",
        "display_symbol": true
      },
      "accounts": [\
        {\
          "id": "123e4567-e89b-12d3-a456-426614174000",\
          "name": "string",\
          "type": "checking",\
          "on_budget": true,\
          "closed": true,\
          "note": null,\
          "balance": 1,\
          "cleared_balance": 1,\
          "uncleared_balance": 1,\
          "transfer_payee_id": null,\
          "...": "[Additional Properties Truncated]"\
        }\
      ],
      "payees": [\
        {\
          "id": "123e4567-e89b-12d3-a456-426614174000",\
          "name": "string",\
          "transfer_account_id": null,\
          "deleted": true\
        }\
      ],
      "payee_locations": [\
        {\
          "id": "123e4567-e89b-12d3-a456-426614174000",\
          "payee_id": "123e4567-e89b-12d3-a456-426614174000",\
          "latitude": "string",\
          "longitude": "string",\
          "deleted": true\
        }\
      ],
      "category_groups": [\
        {\
          "id": "123e4567-e89b-12d3-a456-426614174000",\
          "name": "string",\
          "hidden": true,\
          "deleted": true\
        }\
      ],
      "categories": [\
        {\
          "id": "123e4567-e89b-12d3-a456-426614174000",\
          "category_group_id": "123e4567-e89b-12d3-a456-426614174000",\
          "category_group_name": "string",\
          "name": "string",\
          "hidden": true,\
          "original_category_group_id": null,\
          "note": null,\
          "budgeted": 1,\
          "activity": 1,\
          "balance": 1,\
          "...": "[Additional Properties Truncated]"\
        }\
      ],
      "months": [\
        {\
          "month": "2026-03-20",\
          "note": null,\
          "income": 1,\
          "budgeted": 1,\
          "activity": 1,\
          "to_be_budgeted": 1,\
          "age_of_money": null,\
          "deleted": true,\
          "categories": [\
            {\
              "id": "123e4567-e89b-12d3-a456-426614174000",\
              "category_group_id": "123e4567-e89b-12d3-a456-426614174000",\
              "category_group_name": "string",\
              "name": "string",\
              "hidden": true,\
              "original_category_group_id": null,\
              "note": null,\
              "budgeted": 1,\
              "activity": 1,\
              "balance": 1,\
              "...": "[Additional Properties Truncated]"\
            }\
          ]\
        }\
      ],
      "transactions": [\
        {\
          "id": "string",\
          "date": "2026-03-20",\
          "amount": 1,\
          "memo": null,\
          "cleared": "cleared",\
          "approved": true,\
          "flag_color": "red",\
          "flag_name": null,\
          "account_id": "123e4567-e89b-12d3-a456-426614174000",\
          "payee_id": null,\
          "...": "[Additional Properties Truncated]"\
        }\
      ],
      "subtransactions": [\
        {\
          "id": "string",\
          "transaction_id": "string",\
          "amount": 1,\
          "memo": null,\
          "payee_id": null,\
          "payee_name": null,\
          "category_id": null,\
          "category_name": null,\
          "transfer_account_id": null,\
          "transfer_transaction_id": null,\
          "...": "[Additional Properties Truncated]"\
        }\
      ],
      "scheduled_transactions": [\
        {\
          "id": "123e4567-e89b-12d3-a456-426614174000",\
          "date_first": "2026-03-20",\
          "date_next": "2026-03-20",\
          "frequency": "never",\
          "amount": 1,\
          "memo": null,\
          "flag_color": "red",\
          "flag_name": null,\
          "account_id": "123e4567-e89b-12d3-a456-426614174000",\
          "payee_id": null,\
          "...": "[Additional Properties Truncated]"\
        }\
      ],
      "scheduled_subtransactions": [\
        {\
          "id": "123e4567-e89b-12d3-a456-426614174000",\
          "scheduled_transaction_id": "123e4567-e89b-12d3-a456-426614174000",\
          "amount": 1,\
          "memo": null,\
          "payee_id": null,\
          "payee_name": null,\
          "category_id": null,\
          "category_name": null,\
          "transfer_account_id": null,\
          "deleted": true\
        }\
      ]
    },
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The requested plan

### Get plan settings

​Copy link

Returns settings for a plan

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/settings

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/settings' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/settings)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "settings": {
      "date_format": {
        "format": "string"
      },
      "currency_format": {
        "iso_code": "string",
        "example_format": "string",
        "decimal_digits": 1,
        "decimal_separator": "string",
        "symbol_first": true,
        "group_separator": "string",
        "currency_symbol": "string",
        "display_symbol": true
      }
    }
  }
}
```

JSONCopy

JSONCopy

The requested plan settings

## Accounts

​Copy link

The accounts for a plan

Accounts Operations

- get/plans/{plan\_id}/accounts
- post/plans/{plan\_id}/accounts
- get/plans/{plan\_id}/accounts/{account\_id}

### Get all accounts

​Copy link

Returns all accounts

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).


Query Parameters

- last\_knowledge\_of\_serverCopy link to last\_knowledge\_of\_server



Type: integerFormat: int64







The starting server knowledge. If provided, only entities that have changed since `last_knowledge_of_server` will be included.


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/accounts

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/accounts' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/accounts)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "accounts": [\
      {\
        "id": "123e4567-e89b-12d3-a456-426614174000",\
        "name": "string",\
        "type": "checking",\
        "on_budget": true,\
        "closed": true,\
        "note": null,\
        "balance": 1,\
        "cleared_balance": 1,\
        "uncleared_balance": 1,\
        "transfer_payee_id": null,\
        "direct_import_linked": true,\
        "direct_import_in_error": true,\
        "last_reconciled_at": null,\
        "debt_original_balance": null,\
        "debt_interest_rates": null,\
        "debt_minimum_payments": null,\
        "debt_escrow_amounts": null,\
        "deleted": true\
      }\
    ],
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The list of requested accounts

### Create an account

​Copy link

Creates a new account

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan ("last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan))


Body

required

application/json

The account to create.

- accountCopy link to account



Type: SaveAccount

required







Show Child Attributesfor account


Responses

- 201Copy link to 201



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 400Copy link to 400



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for post/plans/ _{plan\_id}_/accounts

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/accounts' \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN' \
  --data '{
  "account": {
    "name": "",
    "type": "checking",
    "balance": 1
  }
}'
```

cURLCopy

cURLCopy

Test Request(post /plans/{plan\_id}/accounts)

Status: 201Status: 400

Show Schema

```json
{
  "data": {
    "account": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "string",
      "type": "checking",
      "on_budget": true,
      "closed": true,
      "note": null,
      "balance": 1,
      "cleared_balance": 1,
      "uncleared_balance": 1,
      "transfer_payee_id": null,
      "direct_import_linked": true,
      "direct_import_in_error": true,
      "last_reconciled_at": null,
      "debt_original_balance": null,
      "debt_interest_rates": null,
      "debt_minimum_payments": null,
      "debt_escrow_amounts": null,
      "deleted": true
    }
  }
}
```

JSONCopy

JSONCopy

The account was successfully created

### Get an account

​Copy link

Returns a single account

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- account\_idCopy link to account\_id



Type: stringFormat: uuid

required









The id of the account


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/accounts/ _{account\_id}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/accounts/123e4567-e89b-12d3-a456-426614174000' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/accounts/{account\_id})

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "account": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "string",
      "type": "checking",
      "on_budget": true,
      "closed": true,
      "note": null,
      "balance": 1,
      "cleared_balance": 1,
      "uncleared_balance": 1,
      "transfer_payee_id": null,
      "direct_import_linked": true,
      "direct_import_in_error": true,
      "last_reconciled_at": null,
      "debt_original_balance": null,
      "debt_interest_rates": null,
      "debt_minimum_payments": null,
      "debt_escrow_amounts": null,
      "deleted": true
    }
  }
}
```

JSONCopy

JSONCopy

The requested account

## Categories

​Copy link

The categories for a plan

Categories Operations

- get/plans/{plan\_id}/categories
- post/plans/{plan\_id}/categories
- get/plans/{plan\_id}/categories/{category\_id}
- patch/plans/{plan\_id}/categories/{category\_id}
- get/plans/{plan\_id}/months/{month}/categories/{category\_id}
- patch/plans/{plan\_id}/months/{month}/categories/{category\_id}
- post/plans/{plan\_id}/category\_groups
- patch/plans/{plan\_id}/category\_groups/{category\_group\_id}

### Get all categories

​Copy link

Returns all categories grouped by category group. Amounts (assigned, activity, available, etc.) are specific to the current plan month (UTC).

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).


Query Parameters

- last\_knowledge\_of\_serverCopy link to last\_knowledge\_of\_server



Type: integerFormat: int64







The starting server knowledge. If provided, only entities that have changed since `last_knowledge_of_server` will be included.


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/categories

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/categories' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/categories)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "category_groups": [\
      {\
        "id": "123e4567-e89b-12d3-a456-426614174000",\
        "name": "string",\
        "hidden": true,\
        "deleted": true,\
        "categories": [\
          {\
            "id": "123e4567-e89b-12d3-a456-426614174000",\
            "category_group_id": "123e4567-e89b-12d3-a456-426614174000",\
            "category_group_name": "string",\
            "name": "string",\
            "hidden": true,\
            "original_category_group_id": null,\
            "note": null,\
            "budgeted": 1,\
            "activity": 1,\
            "balance": 1,\
            "...": "[Additional Properties Truncated]"\
          }\
        ]\
      }\
    ],
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The categories grouped by category group

### Create a category

​Copy link

Creates a new category

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan ("last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan))


Body

required

application/json

The category to create.

- categoryCopy link to category





required









  - category\_group\_id

    Type: stringFormat: uuid

    required

  - name

    Type: string \| null

    required

  - goal\_target

    Type: integer \| nullFormat: int64





    The goal target amount in milliunits format. If value is specified and goal has not already been configured for category, a monthly 'Needed for Spending' goal will be created for the category with this target amount.

  - goal\_target\_date

    Type: string \| nullFormat: date





    The goal target date in ISO format (e.g. 2016-12-01).

  - note

    Type: string \| null


Responses

- 201Copy link to 201



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 400Copy link to 400



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for post/plans/ _{plan\_id}_/categories

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/categories' \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN' \
  --data '{
  "category": null
}'
```

cURLCopy

cURLCopy

Test Request(post /plans/{plan\_id}/categories)

Status: 201Status: 400

Show Schema

```json
{
  "data": {
    "category": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "category_group_id": "123e4567-e89b-12d3-a456-426614174000",
      "category_group_name": "string",
      "name": "string",
      "hidden": true,
      "original_category_group_id": null,
      "note": null,
      "budgeted": 1,
      "activity": 1,
      "balance": 1,
      "goal_type": "TB",
      "goal_needs_whole_amount": null,
      "goal_day": null,
      "goal_cadence": null,
      "goal_cadence_frequency": null,
      "goal_creation_month": null,
      "goal_target": null,
      "goal_target_month": null,
      "goal_target_date": null,
      "goal_percentage_complete": null,
      "goal_months_to_budget": null,
      "goal_under_funded": null,
      "goal_overall_funded": null,
      "goal_overall_left": null,
      "goal_snoozed_at": null,
      "deleted": true
    },
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The category was successfully created

### Get a category

​Copy link

Returns a single category. Amounts (assigned, activity, available, etc.) are specific to the current plan month (UTC).

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- category\_idCopy link to category\_id



Type: string

required









The id of the category


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/categories/ _{category\_id}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/categories/{category_id}' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/categories/{category\_id})

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "category": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "category_group_id": "123e4567-e89b-12d3-a456-426614174000",
      "category_group_name": "string",
      "name": "string",
      "hidden": true,
      "original_category_group_id": null,
      "note": null,
      "budgeted": 1,
      "activity": 1,
      "balance": 1,
      "goal_type": "TB",
      "goal_needs_whole_amount": null,
      "goal_day": null,
      "goal_cadence": null,
      "goal_cadence_frequency": null,
      "goal_creation_month": null,
      "goal_target": null,
      "goal_target_month": null,
      "goal_target_date": null,
      "goal_percentage_complete": null,
      "goal_months_to_budget": null,
      "goal_under_funded": null,
      "goal_overall_funded": null,
      "goal_overall_left": null,
      "goal_snoozed_at": null,
      "deleted": true
    }
  }
}
```

JSONCopy

JSONCopy

The requested category

### Update a category

​Copy link

Update a category

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- category\_idCopy link to category\_id



Type: string

required









The id of the category


Body

required

application/json

The category to update

- categoryCopy link to category





required









  - category\_group\_id

    Type: stringFormat: uuid

  - goal\_target

    Type: integer \| nullFormat: int64





    The goal target amount in milliunits format. If value is specified and goal has not already been configured for category, a monthly 'Needed for Spending' goal will be created for the category with this target amount.

  - goal\_target\_date

    Type: string \| nullFormat: date





    The goal target date in ISO format (e.g. 2016-12-01).

  - name

    Type: string \| null

  - note

    Type: string \| null


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 400Copy link to 400



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for patch/plans/ _{plan\_id}_/categories/ _{category\_id}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/categories/{category_id}' \
  --request PATCH \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN' \
  --data '{
  "category": {
    "name": null,
    "note": null,
    "category_group_id": "",
    "goal_target": null,
    "goal_target_date": null
  }
}'
```

cURLCopy

cURLCopy

Test Request(patch /plans/{plan\_id}/categories/{category\_id})

Status: 200Status: 400

Show Schema

```json
{
  "data": {
    "category": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "category_group_id": "123e4567-e89b-12d3-a456-426614174000",
      "category_group_name": "string",
      "name": "string",
      "hidden": true,
      "original_category_group_id": null,
      "note": null,
      "budgeted": 1,
      "activity": 1,
      "balance": 1,
      "goal_type": "TB",
      "goal_needs_whole_amount": null,
      "goal_day": null,
      "goal_cadence": null,
      "goal_cadence_frequency": null,
      "goal_creation_month": null,
      "goal_target": null,
      "goal_target_month": null,
      "goal_target_date": null,
      "goal_percentage_complete": null,
      "goal_months_to_budget": null,
      "goal_under_funded": null,
      "goal_overall_funded": null,
      "goal_overall_left": null,
      "goal_snoozed_at": null,
      "deleted": true
    },
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The category was successfully updated

### Get a category for a specific plan month

​Copy link

Returns a single category for a specific plan month. Amounts (assigned, activity, available, etc.) are specific to the current plan month (UTC).

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- monthCopy link to month



Type: stringFormat: date

required









The plan month in ISO format (e.g. 2016-12-01) ("current" can also be used to specify the current calendar month (UTC))

- category\_idCopy link to category\_id



Type: string

required









The id of the category


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/months/ _{month}_/categories/ _{category\_id}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/months/2026-03-20/categories/{category_id}' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/months/{month}/categories/{category\_id})

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "category": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "category_group_id": "123e4567-e89b-12d3-a456-426614174000",
      "category_group_name": "string",
      "name": "string",
      "hidden": true,
      "original_category_group_id": null,
      "note": null,
      "budgeted": 1,
      "activity": 1,
      "balance": 1,
      "goal_type": "TB",
      "goal_needs_whole_amount": null,
      "goal_day": null,
      "goal_cadence": null,
      "goal_cadence_frequency": null,
      "goal_creation_month": null,
      "goal_target": null,
      "goal_target_month": null,
      "goal_target_date": null,
      "goal_percentage_complete": null,
      "goal_months_to_budget": null,
      "goal_under_funded": null,
      "goal_overall_funded": null,
      "goal_overall_left": null,
      "goal_snoozed_at": null,
      "deleted": true
    }
  }
}
```

JSONCopy

JSONCopy

The requested month category

### Update a category for a specific month

​Copy link

Update a category for a specific month. Only `budgeted` (assigned) amount can be updated.

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- monthCopy link to month



Type: stringFormat: date

required









The plan month in ISO format (e.g. 2016-12-01) ("current" can also be used to specify the current calendar month (UTC))

- category\_idCopy link to category\_id



Type: string

required









The id of the category


Body

required

application/json

The category to update. Only `budgeted` (assigned) amount can be updated and any other fields specified will be ignored.

- categoryCopy link to category



Type: SaveMonthCategory

required







Show Child Attributesfor category


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 400Copy link to 400



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for patch/plans/ _{plan\_id}_/months/ _{month}_/categories/ _{category\_id}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/months/2026-03-20/categories/{category_id}' \
  --request PATCH \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN' \
  --data '{
  "category": {
    "budgeted": 1
  }
}'
```

cURLCopy

cURLCopy

Test Request(patch /plans/{plan\_id}/months/{month}/categories/{category\_id})

Status: 200Status: 400

Show Schema

```json
{
  "data": {
    "category": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "category_group_id": "123e4567-e89b-12d3-a456-426614174000",
      "category_group_name": "string",
      "name": "string",
      "hidden": true,
      "original_category_group_id": null,
      "note": null,
      "budgeted": 1,
      "activity": 1,
      "balance": 1,
      "goal_type": "TB",
      "goal_needs_whole_amount": null,
      "goal_day": null,
      "goal_cadence": null,
      "goal_cadence_frequency": null,
      "goal_creation_month": null,
      "goal_target": null,
      "goal_target_month": null,
      "goal_target_date": null,
      "goal_percentage_complete": null,
      "goal_months_to_budget": null,
      "goal_under_funded": null,
      "goal_overall_funded": null,
      "goal_overall_left": null,
      "goal_snoozed_at": null,
      "deleted": true
    },
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The month category was successfully updated

### Create a category group

​Copy link

Creates a new category group

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan ("last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan))


Body

required

application/json

The category group to create.

- category\_groupCopy link to category\_group



Type: SaveCategoryGroup

required







Show Child Attributesfor category\_group


Responses

- 201Copy link to 201



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 400Copy link to 400



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for post/plans/ _{plan\_id}_/category\_groups

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/category_groups' \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN' \
  --data '{
  "category_group": {
    "name": ""
  }
}'
```

cURLCopy

cURLCopy

Test Request(post /plans/{plan\_id}/category\_groups)

Status: 201Status: 400

Show Schema

```json
{
  "data": {
    "category_group": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "string",
      "hidden": true,
      "deleted": true
    },
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The category group was successfully created

### Update a category group

​Copy link

Update a category group

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- category\_group\_idCopy link to category\_group\_id



Type: string

required









The id of the category group


Body

required

application/json

The category group to update

- category\_groupCopy link to category\_group



Type: SaveCategoryGroup

required







Show Child Attributesfor category\_group


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 400Copy link to 400



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for patch/plans/ _{plan\_id}_/category\_groups/ _{category\_group\_id}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/category_groups/{category_group_id}' \
  --request PATCH \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN' \
  --data '{
  "category_group": {
    "name": ""
  }
}'
```

cURLCopy

cURLCopy

Test Request(patch /plans/{plan\_id}/category\_groups/{category\_group\_id})

Status: 200Status: 400

Show Schema

```json
{
  "data": {
    "category_group": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "string",
      "hidden": true,
      "deleted": true
    },
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The category group was successfully updated

## Payees

​Copy link

The payees for a plan

Payees Operations

- get/plans/{plan\_id}/payees
- get/plans/{plan\_id}/payees/{payee\_id}
- patch/plans/{plan\_id}/payees/{payee\_id}

### Get all payees

​Copy link

Returns all payees

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).


Query Parameters

- last\_knowledge\_of\_serverCopy link to last\_knowledge\_of\_server



Type: integerFormat: int64







The starting server knowledge. If provided, only entities that have changed since `last_knowledge_of_server` will be included.


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/payees

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/payees' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/payees)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "payees": [\
      {\
        "id": "123e4567-e89b-12d3-a456-426614174000",\
        "name": "string",\
        "transfer_account_id": null,\
        "deleted": true\
      }\
    ],
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The requested list of payees

### Get a payee

​Copy link

Returns a single payee

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- payee\_idCopy link to payee\_id



Type: string

required









The id of the payee


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/payees/ _{payee\_id}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/payees/{payee_id}' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/payees/{payee\_id})

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "payee": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "string",
      "transfer_account_id": null,
      "deleted": true
    }
  }
}
```

JSONCopy

JSONCopy

The requested payee

### Update a payee

​Copy link

Update a payee

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- payee\_idCopy link to payee\_id



Type: string

required









The id of the payee


Body

required

application/json

The payee to update

- payeeCopy link to payee



Type: SavePayee

required







Show Child Attributesfor payee


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 400Copy link to 400



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for patch/plans/ _{plan\_id}_/payees/ _{payee\_id}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/payees/{payee_id}' \
  --request PATCH \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN' \
  --data '{
  "payee": {
    "name": ""
  }
}'
```

cURLCopy

cURLCopy

Test Request(patch /plans/{plan\_id}/payees/{payee\_id})

Status: 200Status: 400

Show Schema

```json
{
  "data": {
    "payee": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "string",
      "transfer_account_id": null,
      "deleted": true
    },
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The payee was successfully updated

## Payee Locations

​Copy link

When you enter a transaction and specify a payee on the YNAB mobile apps, the GPS coordinates for that location are stored, with your permission, so that the next time you are in the same place (like the Grocery store) we can pre-populate nearby payees for you! It’s handy and saves you time. This resource makes these locations available. Locations will not be available for all payees.

Payee Locations Operations

- get/plans/{plan\_id}/payee\_locations
- get/plans/{plan\_id}/payee\_locations/{payee\_location\_id}
- get/plans/{plan\_id}/payees/{payee\_id}/payee\_locations

### Get all payee locations

​Copy link

Returns all payee locations

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/payee\_locations

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/payee_locations' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/payee\_locations)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "payee_locations": [\
      {\
        "id": "123e4567-e89b-12d3-a456-426614174000",\
        "payee_id": "123e4567-e89b-12d3-a456-426614174000",\
        "latitude": "string",\
        "longitude": "string",\
        "deleted": true\
      }\
    ]
  }
}
```

JSONCopy

JSONCopy

The list of payee locations

### Get a payee location

​Copy link

Returns a single payee location

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- payee\_location\_idCopy link to payee\_location\_id



Type: string

required









id of payee location


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/payee\_locations/ _{payee\_location\_id}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/payee_locations/{payee_location_id}' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/payee\_locations/{payee\_location\_id})

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "payee_location": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "payee_id": "123e4567-e89b-12d3-a456-426614174000",
      "latitude": "string",
      "longitude": "string",
      "deleted": true
    }
  }
}
```

JSONCopy

JSONCopy

The payee location

### Get all locations for a payee

​Copy link

Returns all payee locations for a specified payee

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- payee\_idCopy link to payee\_id



Type: string

required









id of payee


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/payees/ _{payee\_id}_/payee\_locations

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/payees/{payee_id}/payee_locations' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/payees/{payee\_id}/payee\_locations)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "payee_locations": [\
      {\
        "id": "123e4567-e89b-12d3-a456-426614174000",\
        "payee_id": "123e4567-e89b-12d3-a456-426614174000",\
        "latitude": "string",\
        "longitude": "string",\
        "deleted": true\
      }\
    ]
  }
}
```

JSONCopy

JSONCopy

The list of requested payee locations

## Months

​Copy link

Each plan contains one or more months, which is where Ready to Assign, Age of Money and category (assigned / activity / available) amounts are available.

Months Operations

- get/plans/{plan\_id}/months
- get/plans/{plan\_id}/months/{month}

### Get all plan months

​Copy link

Returns all plan months

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).


Query Parameters

- last\_knowledge\_of\_serverCopy link to last\_knowledge\_of\_server



Type: integerFormat: int64







The starting server knowledge. If provided, only entities that have changed since `last_knowledge_of_server` will be included.


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/months

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/months' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/months)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "months": [\
      {\
        "month": "2026-03-20",\
        "note": null,\
        "income": 1,\
        "budgeted": 1,\
        "activity": 1,\
        "to_be_budgeted": 1,\
        "age_of_money": null,\
        "deleted": true\
      }\
    ],
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The list of plan months

### Get a plan month

​Copy link

Returns a single plan month

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- monthCopy link to month



Type: stringFormat: date

required









The plan month in ISO format (e.g. 2016-12-01) ("current" can also be used to specify the current calendar month (UTC))


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/months/ _{month}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/months/2026-03-20' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/months/{month})

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "month": {
      "month": "2026-03-20",
      "note": null,
      "income": 1,
      "budgeted": 1,
      "activity": 1,
      "to_be_budgeted": 1,
      "age_of_money": null,
      "deleted": true,
      "categories": [\
        {\
          "id": "123e4567-e89b-12d3-a456-426614174000",\
          "category_group_id": "123e4567-e89b-12d3-a456-426614174000",\
          "category_group_name": "string",\
          "name": "string",\
          "hidden": true,\
          "original_category_group_id": null,\
          "note": null,\
          "budgeted": 1,\
          "activity": 1,\
          "balance": 1,\
          "...": "[Additional Properties Truncated]"\
        }\
      ]
    }
  }
}
```

JSONCopy

JSONCopy

The plan month detail

## Money Movements

​Copy link

The money movements for a plan

Money Movements Operations

- get/plans/{plan\_id}/money\_movements
- get/plans/{plan\_id}/months/{month}/money\_movements
- get/plans/{plan\_id}/money\_movement\_groups
- get/plans/{plan\_id}/months/{month}/money\_movement\_groups

### Get all money movements

​Copy link

Returns all money movements

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/money\_movements

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/money_movements' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/money\_movements)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "money_movements": [\
      {\
        "id": "123e4567-e89b-12d3-a456-426614174000",\
        "month": null,\
        "moved_at": null,\
        "note": null,\
        "money_movement_group_id": null,\
        "performed_by_user_id": null,\
        "from_category_id": null,\
        "to_category_id": null,\
        "amount": 1\
      }\
    ],
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The list of requested money movements

### Get money movements for a plan month

​Copy link

Returns all money movements for a specific month

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- monthCopy link to month



Type: stringFormat: date

required









The plan month in ISO format (e.g. 2016-12-01) ("current" can also be used to specify the current calendar month (UTC))


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/months/ _{month}_/money\_movements

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/months/2026-03-20/money_movements' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/months/{month}/money\_movements)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "money_movements": [\
      {\
        "id": "123e4567-e89b-12d3-a456-426614174000",\
        "month": null,\
        "moved_at": null,\
        "note": null,\
        "money_movement_group_id": null,\
        "performed_by_user_id": null,\
        "from_category_id": null,\
        "to_category_id": null,\
        "amount": 1\
      }\
    ],
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The list of requested money movements

### Get all money movement groups

​Copy link

Returns all money movement groups

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/money\_movement\_groups

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/money_movement_groups' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/money\_movement\_groups)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "money_movement_groups": [\
      {\
        "id": "123e4567-e89b-12d3-a456-426614174000",\
        "group_created_at": "2026-03-20T16:15:04.325Z",\
        "month": "2026-03-20",\
        "note": null,\
        "performed_by_user_id": null\
      }\
    ],
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The list of requested money movement groups

### Get money movement groups for a plan month

​Copy link

Returns all money movement groups for a specific month

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- monthCopy link to month



Type: stringFormat: date

required









The plan month in ISO format (e.g. 2016-12-01) ("current" can also be used to specify the current calendar month (UTC))


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/months/ _{month}_/money\_movement\_groups

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/months/2026-03-20/money_movement_groups' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/months/{month}/money\_movement\_groups)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "money_movement_groups": [\
      {\
        "id": "123e4567-e89b-12d3-a456-426614174000",\
        "group_created_at": "2026-03-20T16:15:04.325Z",\
        "month": "2026-03-20",\
        "note": null,\
        "performed_by_user_id": null\
      }\
    ],
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The list of requested money movement groups

## Transactions

​Copy link

The transactions for a plan

Transactions Operations

- get/plans/{plan\_id}/transactions
- post/plans/{plan\_id}/transactions
- patch/plans/{plan\_id}/transactions
- post/plans/{plan\_id}/transactions/import
- get/plans/{plan\_id}/transactions/{transaction\_id}
- put/plans/{plan\_id}/transactions/{transaction\_id}
- delete/plans/{plan\_id}/transactions/{transaction\_id}
- get/plans/{plan\_id}/accounts/{account\_id}/transactions
- get/plans/{plan\_id}/categories/{category\_id}/transactions
- get/plans/{plan\_id}/payees/{payee\_id}/transactions
- get/plans/{plan\_id}/months/{month}/transactions

### Get all transactions

​Copy link

Returns plan transactions, excluding any pending transactions

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).


Query Parameters

- since\_dateCopy link to since\_date



Type: stringFormat: date







If specified, only transactions on or after this date will be included. The date should be ISO formatted (e.g. 2016-12-30).

- typeCopy link to type



Type: stringenum







If specified, only transactions of the specified type will be included. "uncategorized" and "unapproved" are currently supported.









  - uncategorized

  - unapproved


- last\_knowledge\_of\_serverCopy link to last\_knowledge\_of\_server



Type: integerFormat: int64







The starting server knowledge. If provided, only entities that have changed since `last_knowledge_of_server` will be included.


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 400Copy link to 400



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/transactions

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/transactions' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/transactions)

Status: 200Status: 400Status: 404

Show Schema

```json
{
  "data": {
    "transactions": [\
      {\
        "id": "string",\
        "date": "2026-03-20",\
        "amount": 1,\
        "memo": null,\
        "cleared": "cleared",\
        "approved": true,\
        "flag_color": "red",\
        "flag_name": null,\
        "account_id": "123e4567-e89b-12d3-a456-426614174000",\
        "payee_id": null,\
        "...": "[Additional Properties Truncated]",\
        "account_name": "string",\
        "payee_name": null,\
        "category_name": null,\
        "subtransactions": [\
          {\
            "id": "string",\
            "transaction_id": "string",\
            "amount": 1,\
            "memo": null,\
            "payee_id": null,\
            "payee_name": null,\
            "category_id": null,\
            "category_name": null,\
            "transfer_account_id": null,\
            "transfer_transaction_id": null,\
            "...": "[Additional Properties Truncated]"\
          }\
        ]\
      }\
    ],
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The list of requested transactions

### Create a single transaction or multiple transactions

​Copy link

Creates a single transaction or multiple transactions. If you provide a body containing a `transaction` object, a single transaction will be created and if you provide a body containing a `transactions` array, multiple transactions will be created. Scheduled transactions (transactions with a future date) cannot be created on this endpoint.

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).


Body

required

application/json

The transaction or transactions to create. To create a single transaction you can specify a value for the `transaction` object and to create multiple transactions you can specify an array of `transactions`. It is expected that you will only provide a value for one of these objects.

- transactionCopy link to transaction











  - account\_id

    Type: stringFormat: uuid

  - amount

    Type: integerFormat: int64





    The transaction amount in milliunits format. Split transaction amounts cannot be changed and if a different amount is supplied it will be ignored.

  - approved

    Type: boolean





    Whether or not the transaction is approved. If not supplied, transaction will be unapproved by default.

  - category\_id

    Type: string \| nullFormat: uuid





    The category for the transaction. To configure a split transaction, you can specify null for `category_id` and provide a `subtransactions` array as part of the transaction object. If an existing transaction is a split, the `category_id` cannot be changed. Credit Card Payment categories are not permitted and will be ignored if supplied.

  - cleared

    Type: TransactionClearedStatusenum





    The cleared status of the transaction







    - cleared

    - uncleared

    - reconciled


  - date

    Type: stringFormat: date





    The transaction date in ISO format (e.g. 2016-12-01). Future dates (scheduled transactions) are not permitted. Split transaction dates cannot be changed and if a different date is supplied it will be ignored.

  - flag\_color

    Type: TransactionFlagColorenum





    The transaction flag







    - red

    - orange

    - yellow

    - green

    - blue

    - purple


    - null


  - import\_id

    Type: string \| null
    max length:
     36





    If specified, a new transaction will be assigned this `import_id` and considered "imported". We will also attempt to match this imported transaction to an existing "user-entered" transaction on the same account, with the same amount, and with a date +/-10 days from the imported transaction date.



    Transactions imported through File Based Import or Direct Import (not through the API) are assigned an import\_id in the format: 'YNAB:\[milliunit\_amount\]:\[iso\_date\]:\[occurrence\]'. For example, a transaction dated 2015-12-30 in the amount of -$294.23 USD would have an import\_id of 'YNAB:-294230:2015-12-30:1'. If a second transaction on the same account was imported and had the same date and same amount, its import\_id would be 'YNAB:-294230:2015-12-30:2'. Using a consistent format will prevent duplicates through Direct Import and File Based Import.



    If import\_id is omitted or specified as null, the transaction will be treated as a "user-entered" transaction. As such, it will be eligible to be matched against transactions later being imported (via DI, FBI, or API).

  - memo

    Type: string \| null
    max length:
     500

  - payee\_id

    Type: string \| nullFormat: uuid





    The payee for the transaction. To create a transfer between two accounts, use the account transfer payee pointing to the target account. Account transfer payees are specified as `transfer_payee_id` on the account resource.

  - payee\_name

    Type: string \| null
    max length:
     200





    The payee name. If a `payee_name` value is provided and `payee_id` has a null value, the `payee_name` value will be used to resolve the payee by either (1) a matching payee rename rule (only if `import_id` is also specified) or (2) a payee with the same name or (3) creation of a new payee.

  - subtransactions

    Type: array SaveSubTransaction\[\]





    An array of subtransactions to configure a transaction as a split. Updating `subtransactions` on an existing split transaction is not supported.









    Show Child Attributesfor subtransactions


- transactionsCopy link to transactions



Type: array object\[\]





Show Child Attributesfor transactions


Responses

- 201Copy link to 201



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 400Copy link to 400



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


- 409Copy link to 409



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for post/plans/ _{plan\_id}_/transactions

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/transactions' \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN' \
  --data '{
  "transaction": {
    "account_id": "",
    "date": "",
    "amount": 1,
    "payee_id": null,
    "payee_name": null,
    "category_id": null,
    "memo": null,
    "cleared": "cleared",
    "approved": true,
    "flag_color": "red",
    "subtransactions": [\
      {\
        "amount": 1,\
        "payee_id": null,\
        "payee_name": null,\
        "category_id": null,\
        "memo": null\
      }\
    ],
    "import_id": null
  },
  "transactions": [\
    {\
      "account_id": "",\
      "date": "",\
      "amount": 1,\
      "payee_id": null,\
      "payee_name": null,\
      "category_id": null,\
      "memo": null,\
      "cleared": "cleared",\
      "approved": true,\
      "flag_color": "red",\
      "subtransactions": [\
        {\
          "amount": 1,\
          "payee_id": null,\
          "payee_name": null,\
          "category_id": null,\
          "memo": null\
        }\
      ],\
      "import_id": null\
    }\
  ]
}'
```

cURLCopy

cURLCopy

Test Request(post /plans/{plan\_id}/transactions)

Status: 201Status: 400Status: 409

Show Schema

```json
{
  "data": {
    "transaction_ids": [\
      "string"\
    ],
    "transaction": {
      "id": "string",
      "date": "2026-03-20",
      "amount": 1,
      "memo": null,
      "cleared": "cleared",
      "approved": true,
      "flag_color": "red",
      "flag_name": null,
      "account_id": "123e4567-e89b-12d3-a456-426614174000",
      "payee_id": null,
      "category_id": null,
      "transfer_account_id": null,
      "transfer_transaction_id": null,
      "matched_transaction_id": null,
      "import_id": null,
      "import_payee_name": null,
      "import_payee_name_original": null,
      "debt_transaction_type": "payment",
      "deleted": true,
      "account_name": "string",
      "payee_name": null,
      "category_name": null,
      "subtransactions": [\
        {\
          "id": "string",\
          "transaction_id": "string",\
          "amount": 1,\
          "memo": null,\
          "payee_id": null,\
          "payee_name": null,\
          "category_id": null,\
          "category_name": null,\
          "transfer_account_id": null,\
          "transfer_transaction_id": null,\
          "...": "[Additional Properties Truncated]"\
        }\
      ]
    },
    "transactions": [\
      {\
        "id": "string",\
        "date": "2026-03-20",\
        "amount": 1,\
        "memo": null,\
        "cleared": "cleared",\
        "approved": true,\
        "flag_color": "red",\
        "flag_name": null,\
        "account_id": "123e4567-e89b-12d3-a456-426614174000",\
        "payee_id": null,\
        "...": "[Additional Properties Truncated]",\
        "account_name": "string",\
        "payee_name": null,\
        "category_name": null,\
        "subtransactions": [\
          {\
            "id": "string",\
            "transaction_id": "string",\
            "amount": 1,\
            "memo": null,\
            "payee_id": null,\
            "payee_name": null,\
            "category_id": null,\
            "category_name": null,\
            "transfer_account_id": null,\
            "transfer_transaction_id": null,\
            "...": "[Additional Properties Truncated]"\
          }\
        ]\
      }\
    ],
    "duplicate_import_ids": [\
      "string"\
    ],
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The transaction or transactions were successfully created

### Update multiple transactions

​Copy link

Updates multiple transactions, by `id` or `import_id`.

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).


Body

required

application/json

The transactions to update. Each transaction must have either an `id` or `import_id` specified. If `id` is specified as null an `import_id` value can be provided which will allow transaction(s) to be updated by its `import_id`. If an `id` is specified, it will always be used for lookup. You should not specify both `id` and `import_id`. Updating an `import_id` on an existing transaction is not allowed; if an `import_id` is specified, it will only be used to lookup the transaction.

- transactionsCopy link to transactions



Type: array object\[\]

required







Show Child Attributesfor transactions


Responses

- 209Copy link to 209



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 400Copy link to 400



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for patch/plans/ _{plan\_id}_/transactions

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/transactions' \
  --request PATCH \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN' \
  --data '{
  "transactions": [\
    {\
      "id": null,\
      "import_id": null,\
      "account_id": "",\
      "date": "",\
      "amount": 1,\
      "payee_id": null,\
      "payee_name": null,\
      "category_id": null,\
      "memo": null,\
      "cleared": "cleared",\
      "approved": true,\
      "flag_color": "red",\
      "subtransactions": [\
        {\
          "amount": 1,\
          "payee_id": null,\
          "payee_name": null,\
          "category_id": null,\
          "memo": null\
        }\
      ]\
    }\
  ]
}'
```

cURLCopy

cURLCopy

Test Request(patch /plans/{plan\_id}/transactions)

Status: 209Status: 400

Show Schema

```json
{
  "data": {
    "transaction_ids": [\
      "string"\
    ],
    "transaction": {
      "id": "string",
      "date": "2026-03-20",
      "amount": 1,
      "memo": null,
      "cleared": "cleared",
      "approved": true,
      "flag_color": "red",
      "flag_name": null,
      "account_id": "123e4567-e89b-12d3-a456-426614174000",
      "payee_id": null,
      "category_id": null,
      "transfer_account_id": null,
      "transfer_transaction_id": null,
      "matched_transaction_id": null,
      "import_id": null,
      "import_payee_name": null,
      "import_payee_name_original": null,
      "debt_transaction_type": "payment",
      "deleted": true,
      "account_name": "string",
      "payee_name": null,
      "category_name": null,
      "subtransactions": [\
        {\
          "id": "string",\
          "transaction_id": "string",\
          "amount": 1,\
          "memo": null,\
          "payee_id": null,\
          "payee_name": null,\
          "category_id": null,\
          "category_name": null,\
          "transfer_account_id": null,\
          "transfer_transaction_id": null,\
          "...": "[Additional Properties Truncated]"\
        }\
      ]
    },
    "transactions": [\
      {\
        "id": "string",\
        "date": "2026-03-20",\
        "amount": 1,\
        "memo": null,\
        "cleared": "cleared",\
        "approved": true,\
        "flag_color": "red",\
        "flag_name": null,\
        "account_id": "123e4567-e89b-12d3-a456-426614174000",\
        "payee_id": null,\
        "...": "[Additional Properties Truncated]",\
        "account_name": "string",\
        "payee_name": null,\
        "category_name": null,\
        "subtransactions": [\
          {\
            "id": "string",\
            "transaction_id": "string",\
            "amount": 1,\
            "memo": null,\
            "payee_id": null,\
            "payee_name": null,\
            "category_id": null,\
            "category_name": null,\
            "transfer_account_id": null,\
            "transfer_transaction_id": null,\
            "...": "[Additional Properties Truncated]"\
          }\
        ]\
      }\
    ],
    "duplicate_import_ids": [\
      "string"\
    ],
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The transactions were successfully updated

### Import transactions

​Copy link

Imports available transactions on all linked accounts for the given plan. Linked accounts allow transactions to be imported directly from a specified financial institution and this endpoint initiates that import. Sending a request to this endpoint is the equivalent of clicking "Import" on each account in the web application or tapping the "New Transactions" banner in the mobile applications. The response for this endpoint contains the transaction ids that have been imported.

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 201Copy link to 201



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 400Copy link to 400



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for post/plans/ _{plan\_id}_/transactions/import

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/transactions/import' \
  --request POST \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(post /plans/{plan\_id}/transactions/import)

Status: 200Status: 201Status: 400

Show Schema

```json
{
  "data": {
    "transaction_ids": [\
      "string"\
    ]
  }
}
```

JSONCopy

JSONCopy

The request was successful but there were no transactions to import

### Get a transaction

​Copy link

Returns a single transaction

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- transaction\_idCopy link to transaction\_id



Type: string

required









The id of the transaction


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/transactions/ _{transaction\_id}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/transactions/{transaction_id}' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/transactions/{transaction\_id})

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "transaction": {
      "id": "string",
      "date": "2026-03-20",
      "amount": 1,
      "memo": null,
      "cleared": "cleared",
      "approved": true,
      "flag_color": "red",
      "flag_name": null,
      "account_id": "123e4567-e89b-12d3-a456-426614174000",
      "payee_id": null,
      "category_id": null,
      "transfer_account_id": null,
      "transfer_transaction_id": null,
      "matched_transaction_id": null,
      "import_id": null,
      "import_payee_name": null,
      "import_payee_name_original": null,
      "debt_transaction_type": "payment",
      "deleted": true,
      "account_name": "string",
      "payee_name": null,
      "category_name": null,
      "subtransactions": [\
        {\
          "id": "string",\
          "transaction_id": "string",\
          "amount": 1,\
          "memo": null,\
          "payee_id": null,\
          "payee_name": null,\
          "category_id": null,\
          "category_name": null,\
          "transfer_account_id": null,\
          "transfer_transaction_id": null,\
          "...": "[Additional Properties Truncated]"\
        }\
      ]
    },
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The requested transaction

### Update a transaction

​Copy link

Updates a single transaction

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- transaction\_idCopy link to transaction\_id



Type: string

required









The id of the transaction


Body

required

application/json

The transaction to update

- transactionCopy link to transaction





required









  - account\_id

    Type: stringFormat: uuid

  - amount

    Type: integerFormat: int64





    The transaction amount in milliunits format. Split transaction amounts cannot be changed and if a different amount is supplied it will be ignored.

  - approved

    Type: boolean





    Whether or not the transaction is approved. If not supplied, transaction will be unapproved by default.

  - category\_id

    Type: string \| nullFormat: uuid





    The category for the transaction. To configure a split transaction, you can specify null for `category_id` and provide a `subtransactions` array as part of the transaction object. If an existing transaction is a split, the `category_id` cannot be changed. Credit Card Payment categories are not permitted and will be ignored if supplied.

  - cleared

    Type: TransactionClearedStatusenum





    The cleared status of the transaction







    - cleared

    - uncleared

    - reconciled


  - date

    Type: stringFormat: date





    The transaction date in ISO format (e.g. 2016-12-01). Future dates (scheduled transactions) are not permitted. Split transaction dates cannot be changed and if a different date is supplied it will be ignored.

  - flag\_color

    Type: TransactionFlagColorenum





    The transaction flag







    - red

    - orange

    - yellow

    - green

    - blue

    - purple


    - null


  - memo

    Type: string \| null
    max length:
     500

  - payee\_id

    Type: string \| nullFormat: uuid





    The payee for the transaction. To create a transfer between two accounts, use the account transfer payee pointing to the target account. Account transfer payees are specified as `transfer_payee_id` on the account resource.

  - payee\_name

    Type: string \| null
    max length:
     200





    The payee name. If a `payee_name` value is provided and `payee_id` has a null value, the `payee_name` value will be used to resolve the payee by either (1) a matching payee rename rule (only if `import_id` is also specified) or (2) a payee with the same name or (3) creation of a new payee.

  - subtransactions

    Type: array SaveSubTransaction\[\]





    An array of subtransactions to configure a transaction as a split. Updating `subtransactions` on an existing split transaction is not supported.









    Show Child Attributesfor subtransactions


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 400Copy link to 400



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for put/plans/ _{plan\_id}_/transactions/ _{transaction\_id}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/transactions/{transaction_id}' \
  --request PUT \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN' \
  --data '{
  "transaction": {
    "account_id": "",
    "date": "",
    "amount": 1,
    "payee_id": null,
    "payee_name": null,
    "category_id": null,
    "memo": null,
    "cleared": "cleared",
    "approved": true,
    "flag_color": "red",
    "subtransactions": [\
      {\
        "amount": 1,\
        "payee_id": null,\
        "payee_name": null,\
        "category_id": null,\
        "memo": null\
      }\
    ]
  }
}'
```

cURLCopy

cURLCopy

Test Request(put /plans/{plan\_id}/transactions/{transaction\_id})

Status: 200Status: 400

Show Schema

```json
{
  "data": {
    "transaction": {
      "id": "string",
      "date": "2026-03-20",
      "amount": 1,
      "memo": null,
      "cleared": "cleared",
      "approved": true,
      "flag_color": "red",
      "flag_name": null,
      "account_id": "123e4567-e89b-12d3-a456-426614174000",
      "payee_id": null,
      "category_id": null,
      "transfer_account_id": null,
      "transfer_transaction_id": null,
      "matched_transaction_id": null,
      "import_id": null,
      "import_payee_name": null,
      "import_payee_name_original": null,
      "debt_transaction_type": "payment",
      "deleted": true,
      "account_name": "string",
      "payee_name": null,
      "category_name": null,
      "subtransactions": [\
        {\
          "id": "string",\
          "transaction_id": "string",\
          "amount": 1,\
          "memo": null,\
          "payee_id": null,\
          "payee_name": null,\
          "category_id": null,\
          "category_name": null,\
          "transfer_account_id": null,\
          "transfer_transaction_id": null,\
          "...": "[Additional Properties Truncated]"\
        }\
      ]
    },
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The transaction was successfully updated

### Delete a transaction

​Copy link

Deletes a transaction

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- transaction\_idCopy link to transaction\_id



Type: string

required









The id of the transaction


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for delete/plans/ _{plan\_id}_/transactions/ _{transaction\_id}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/transactions/{transaction_id}' \
  --request DELETE \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(delete /plans/{plan\_id}/transactions/{transaction\_id})

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "transaction": {
      "id": "string",
      "date": "2026-03-20",
      "amount": 1,
      "memo": null,
      "cleared": "cleared",
      "approved": true,
      "flag_color": "red",
      "flag_name": null,
      "account_id": "123e4567-e89b-12d3-a456-426614174000",
      "payee_id": null,
      "category_id": null,
      "transfer_account_id": null,
      "transfer_transaction_id": null,
      "matched_transaction_id": null,
      "import_id": null,
      "import_payee_name": null,
      "import_payee_name_original": null,
      "debt_transaction_type": "payment",
      "deleted": true,
      "account_name": "string",
      "payee_name": null,
      "category_name": null,
      "subtransactions": [\
        {\
          "id": "string",\
          "transaction_id": "string",\
          "amount": 1,\
          "memo": null,\
          "payee_id": null,\
          "payee_name": null,\
          "category_id": null,\
          "category_name": null,\
          "transfer_account_id": null,\
          "transfer_transaction_id": null,\
          "...": "[Additional Properties Truncated]"\
        }\
      ]
    },
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The transaction was successfully deleted

### Get all account transactions

​Copy link

Returns all transactions for a specified account, excluding any pending transactions

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- account\_idCopy link to account\_id



Type: string

required









The id of the account


Query Parameters

- since\_dateCopy link to since\_date



Type: stringFormat: date







If specified, only transactions on or after this date will be included. The date should be ISO formatted (e.g. 2016-12-30).

- typeCopy link to type



Type: stringenum







If specified, only transactions of the specified type will be included. "uncategorized" and "unapproved" are currently supported.









  - uncategorized

  - unapproved


- last\_knowledge\_of\_serverCopy link to last\_knowledge\_of\_server



Type: integerFormat: int64







The starting server knowledge. If provided, only entities that have changed since `last_knowledge_of_server` will be included.


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/accounts/ _{account\_id}_/transactions

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/accounts/{account_id}/transactions' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/accounts/{account\_id}/transactions)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "transactions": [\
      {\
        "id": "string",\
        "date": "2026-03-20",\
        "amount": 1,\
        "memo": null,\
        "cleared": "cleared",\
        "approved": true,\
        "flag_color": "red",\
        "flag_name": null,\
        "account_id": "123e4567-e89b-12d3-a456-426614174000",\
        "payee_id": null,\
        "...": "[Additional Properties Truncated]",\
        "account_name": "string",\
        "payee_name": null,\
        "category_name": null,\
        "subtransactions": [\
          {\
            "id": "string",\
            "transaction_id": "string",\
            "amount": 1,\
            "memo": null,\
            "payee_id": null,\
            "payee_name": null,\
            "category_id": null,\
            "category_name": null,\
            "transfer_account_id": null,\
            "transfer_transaction_id": null,\
            "...": "[Additional Properties Truncated]"\
          }\
        ]\
      }\
    ],
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The list of requested transactions

### Get all category transactions

​Copy link

Returns all transactions for a specified category, excluding any pending transactions

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- category\_idCopy link to category\_id



Type: string

required









The id of the category


Query Parameters

- since\_dateCopy link to since\_date



Type: stringFormat: date







If specified, only transactions on or after this date will be included. The date should be ISO formatted (e.g. 2016-12-30).

- typeCopy link to type



Type: stringenum







If specified, only transactions of the specified type will be included. "uncategorized" and "unapproved" are currently supported.









  - uncategorized

  - unapproved


- last\_knowledge\_of\_serverCopy link to last\_knowledge\_of\_server



Type: integerFormat: int64







The starting server knowledge. If provided, only entities that have changed since `last_knowledge_of_server` will be included.


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/categories/ _{category\_id}_/transactions

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/categories/{category_id}/transactions' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/categories/{category\_id}/transactions)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "transactions": [\
      {\
        "id": "string",\
        "date": "2026-03-20",\
        "amount": 1,\
        "memo": null,\
        "cleared": "cleared",\
        "approved": true,\
        "flag_color": "red",\
        "flag_name": null,\
        "account_id": "123e4567-e89b-12d3-a456-426614174000",\
        "payee_id": null,\
        "...": "[Additional Properties Truncated]",\
        "type": "transaction",\
        "parent_transaction_id": null,\
        "account_name": "string",\
        "payee_name": null,\
        "category_name": "string"\
      }\
    ],
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The list of requested transactions

### Get all payee transactions

​Copy link

Returns all transactions for a specified payee, excluding any pending transactions

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- payee\_idCopy link to payee\_id



Type: string

required









The id of the payee


Query Parameters

- since\_dateCopy link to since\_date



Type: stringFormat: date







If specified, only transactions on or after this date will be included. The date should be ISO formatted (e.g. 2016-12-30).

- typeCopy link to type



Type: stringenum







If specified, only transactions of the specified type will be included. "uncategorized" and "unapproved" are currently supported.









  - uncategorized

  - unapproved


- last\_knowledge\_of\_serverCopy link to last\_knowledge\_of\_server



Type: integerFormat: int64







The starting server knowledge. If provided, only entities that have changed since `last_knowledge_of_server` will be included.


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/payees/ _{payee\_id}_/transactions

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/payees/{payee_id}/transactions' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/payees/{payee\_id}/transactions)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "transactions": [\
      {\
        "id": "string",\
        "date": "2026-03-20",\
        "amount": 1,\
        "memo": null,\
        "cleared": "cleared",\
        "approved": true,\
        "flag_color": "red",\
        "flag_name": null,\
        "account_id": "123e4567-e89b-12d3-a456-426614174000",\
        "payee_id": null,\
        "...": "[Additional Properties Truncated]",\
        "type": "transaction",\
        "parent_transaction_id": null,\
        "account_name": "string",\
        "payee_name": null,\
        "category_name": "string"\
      }\
    ],
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The list of requested transactions

### Get all plan month transactions

​Copy link

Returns all transactions for a specified month, excluding any pending transactions

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- monthCopy link to month



Type: string

required









The plan month in ISO format (e.g. 2016-12-01) ("current" can also be used to specify the current calendar month (UTC))


Query Parameters

- since\_dateCopy link to since\_date



Type: stringFormat: date







If specified, only transactions on or after this date will be included. The date should be ISO formatted (e.g. 2016-12-30).

- typeCopy link to type



Type: stringenum







If specified, only transactions of the specified type will be included. "uncategorized" and "unapproved" are currently supported.









  - uncategorized

  - unapproved


- last\_knowledge\_of\_serverCopy link to last\_knowledge\_of\_server



Type: integerFormat: int64







The starting server knowledge. If provided, only entities that have changed since `last_knowledge_of_server` will be included.


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/months/ _{month}_/transactions

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/months/{month}/transactions' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/months/{month}/transactions)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "transactions": [\
      {\
        "id": "string",\
        "date": "2026-03-20",\
        "amount": 1,\
        "memo": null,\
        "cleared": "cleared",\
        "approved": true,\
        "flag_color": "red",\
        "flag_name": null,\
        "account_id": "123e4567-e89b-12d3-a456-426614174000",\
        "payee_id": null,\
        "...": "[Additional Properties Truncated]",\
        "account_name": "string",\
        "payee_name": null,\
        "category_name": null,\
        "subtransactions": [\
          {\
            "id": "string",\
            "transaction_id": "string",\
            "amount": 1,\
            "memo": null,\
            "payee_id": null,\
            "payee_name": null,\
            "category_id": null,\
            "category_name": null,\
            "transfer_account_id": null,\
            "transfer_transaction_id": null,\
            "...": "[Additional Properties Truncated]"\
          }\
        ]\
      }\
    ],
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The list of requested transactions

## Scheduled Transactions

​Copy link

The scheduled transactions for a plan

Scheduled Transactions Operations

- get/plans/{plan\_id}/scheduled\_transactions
- post/plans/{plan\_id}/scheduled\_transactions
- get/plans/{plan\_id}/scheduled\_transactions/{scheduled\_transaction\_id}
- put/plans/{plan\_id}/scheduled\_transactions/{scheduled\_transaction\_id}
- delete/plans/{plan\_id}/scheduled\_transactions/{scheduled\_transaction\_id}

### Get all scheduled transactions

​Copy link

Returns all scheduled transactions

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).


Query Parameters

- last\_knowledge\_of\_serverCopy link to last\_knowledge\_of\_server



Type: integerFormat: int64







The starting server knowledge. If provided, only entities that have changed since `last_knowledge_of_server` will be included.


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/scheduled\_transactions

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/scheduled_transactions' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/scheduled\_transactions)

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "scheduled_transactions": [\
      {\
        "id": "123e4567-e89b-12d3-a456-426614174000",\
        "date_first": "2026-03-20",\
        "date_next": "2026-03-20",\
        "frequency": "never",\
        "amount": 1,\
        "memo": null,\
        "flag_color": "red",\
        "flag_name": null,\
        "account_id": "123e4567-e89b-12d3-a456-426614174000",\
        "payee_id": null,\
        "...": "[Additional Properties Truncated]",\
        "account_name": "string",\
        "payee_name": null,\
        "category_name": null,\
        "subtransactions": [\
          {\
            "id": "123e4567-e89b-12d3-a456-426614174000",\
            "scheduled_transaction_id": "123e4567-e89b-12d3-a456-426614174000",\
            "amount": 1,\
            "memo": null,\
            "payee_id": null,\
            "payee_name": null,\
            "category_id": null,\
            "category_name": null,\
            "transfer_account_id": null,\
            "deleted": true\
          }\
        ]\
      }\
    ],
    "server_knowledge": 1
  }
}
```

JSONCopy

JSONCopy

The list of requested scheduled transactions

### Create a scheduled transaction

​Copy link

Creates a single scheduled transaction (a transaction with a future date).

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).


Body

required

application/json

The scheduled transaction to create

- scheduled\_transactionCopy link to scheduled\_transaction



Type: SaveScheduledTransaction

required







Show Child Attributesfor scheduled\_transaction


Responses

- 201Copy link to 201



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 400Copy link to 400



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for post/plans/ _{plan\_id}_/scheduled\_transactions

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/scheduled_transactions' \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN' \
  --data '{
  "scheduled_transaction": {
    "account_id": "",
    "date": "",
    "amount": 1,
    "payee_id": null,
    "payee_name": null,
    "category_id": null,
    "memo": null,
    "flag_color": "red",
    "frequency": "never"
  }
}'
```

cURLCopy

cURLCopy

Test Request(post /plans/{plan\_id}/scheduled\_transactions)

Status: 201Status: 400

Show Schema

```json
{
  "data": {
    "scheduled_transaction": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "date_first": "2026-03-20",
      "date_next": "2026-03-20",
      "frequency": "never",
      "amount": 1,
      "memo": null,
      "flag_color": "red",
      "flag_name": null,
      "account_id": "123e4567-e89b-12d3-a456-426614174000",
      "payee_id": null,
      "category_id": null,
      "transfer_account_id": null,
      "deleted": true,
      "account_name": "string",
      "payee_name": null,
      "category_name": null,
      "subtransactions": [\
        {\
          "id": "123e4567-e89b-12d3-a456-426614174000",\
          "scheduled_transaction_id": "123e4567-e89b-12d3-a456-426614174000",\
          "amount": 1,\
          "memo": null,\
          "payee_id": null,\
          "payee_name": null,\
          "category_id": null,\
          "category_name": null,\
          "transfer_account_id": null,\
          "deleted": true\
        }\
      ]
    }
  }
}
```

JSONCopy

JSONCopy

The scheduled transaction was successfully created

### Get a scheduled transaction

​Copy link

Returns a single scheduled transaction

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- scheduled\_transaction\_idCopy link to scheduled\_transaction\_id



Type: string

required









The id of the scheduled transaction


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for get/plans/ _{plan\_id}_/scheduled\_transactions/ _{scheduled\_transaction\_id}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/scheduled_transactions/{scheduled_transaction_id}' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(get /plans/{plan\_id}/scheduled\_transactions/{scheduled\_transaction\_id})

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "scheduled_transaction": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "date_first": "2026-03-20",
      "date_next": "2026-03-20",
      "frequency": "never",
      "amount": 1,
      "memo": null,
      "flag_color": "red",
      "flag_name": null,
      "account_id": "123e4567-e89b-12d3-a456-426614174000",
      "payee_id": null,
      "category_id": null,
      "transfer_account_id": null,
      "deleted": true,
      "account_name": "string",
      "payee_name": null,
      "category_name": null,
      "subtransactions": [\
        {\
          "id": "123e4567-e89b-12d3-a456-426614174000",\
          "scheduled_transaction_id": "123e4567-e89b-12d3-a456-426614174000",\
          "amount": 1,\
          "memo": null,\
          "payee_id": null,\
          "payee_name": null,\
          "category_id": null,\
          "category_name": null,\
          "transfer_account_id": null,\
          "deleted": true\
        }\
      ]
    }
  }
}
```

JSONCopy

JSONCopy

The requested Scheduled Transaction

### Update a scheduled transaction

​Copy link

Updates a single scheduled transaction

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- scheduled\_transaction\_idCopy link to scheduled\_transaction\_id



Type: string

required









The id of the scheduled transaction


Body

required

application/json

The scheduled transaction to update

- scheduled\_transactionCopy link to scheduled\_transaction



Type: SaveScheduledTransaction

required







Show Child Attributesfor scheduled\_transaction


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 400Copy link to 400



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for put/plans/ _{plan\_id}_/scheduled\_transactions/ _{scheduled\_transaction\_id}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/scheduled_transactions/{scheduled_transaction_id}' \
  --request PUT \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN' \
  --data '{
  "scheduled_transaction": {
    "account_id": "",
    "date": "",
    "amount": 1,
    "payee_id": null,
    "payee_name": null,
    "category_id": null,
    "memo": null,
    "flag_color": "red",
    "frequency": "never"
  }
}'
```

cURLCopy

cURLCopy

Test Request(put /plans/{plan\_id}/scheduled\_transactions/{scheduled\_transaction\_id})

Status: 200Status: 400

Show Schema

```json
{
  "data": {
    "scheduled_transaction": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "date_first": "2026-03-20",
      "date_next": "2026-03-20",
      "frequency": "never",
      "amount": 1,
      "memo": null,
      "flag_color": "red",
      "flag_name": null,
      "account_id": "123e4567-e89b-12d3-a456-426614174000",
      "payee_id": null,
      "category_id": null,
      "transfer_account_id": null,
      "deleted": true,
      "account_name": "string",
      "payee_name": null,
      "category_name": null,
      "subtransactions": [\
        {\
          "id": "123e4567-e89b-12d3-a456-426614174000",\
          "scheduled_transaction_id": "123e4567-e89b-12d3-a456-426614174000",\
          "amount": 1,\
          "memo": null,\
          "payee_id": null,\
          "payee_name": null,\
          "category_id": null,\
          "category_name": null,\
          "transfer_account_id": null,\
          "deleted": true\
        }\
      ]
    }
  }
}
```

JSONCopy

JSONCopy

The scheduled transaction was successfully updated

### Delete a scheduled transaction

​Copy link

Deletes a scheduled transaction

Path Parameters

- plan\_idCopy link to plan\_id



Type: string

required









The id of the plan. "last-used" can be used to specify the last used plan and "default" can be used if default plan selection is enabled (see: [https://api.ynab.com/#oauth-default-plan](https://api.ynab.com/#oauth-default-plan)).

- scheduled\_transaction\_idCopy link to scheduled\_transaction\_id



Type: string

required









The id of the scheduled transaction


Responses

- 200Copy link to 200



Type: object









  - data

    Type: object

    required







    Show Child Attributesfor data


- 404Copy link to 404



Type: object









  - error

    Type: ErrorDetail

    required







    Show Child Attributesfor error


Request Example for delete/plans/ _{plan\_id}_/scheduled\_transactions/ _{scheduled\_transaction\_id}_

Shell Curl

```curl
curl 'https://api.ynab.com/v1/plans/{plan_id}/scheduled_transactions/{scheduled_transaction_id}' \
  --request DELETE \
  --header 'Authorization: Bearer YOUR_SECRET_TOKEN'
```

cURLCopy

cURLCopy

Test Request(delete /plans/{plan\_id}/scheduled\_transactions/{scheduled\_transaction\_id})

Status: 200Status: 404

Show Schema

```json
{
  "data": {
    "scheduled_transaction": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "date_first": "2026-03-20",
      "date_next": "2026-03-20",
      "frequency": "never",
      "amount": 1,
      "memo": null,
      "flag_color": "red",
      "flag_name": null,
      "account_id": "123e4567-e89b-12d3-a456-426614174000",
      "payee_id": null,
      "category_id": null,
      "transfer_account_id": null,
      "deleted": true,
      "account_name": "string",
      "payee_name": null,
      "category_name": null,
      "subtransactions": [\
        {\
          "id": "123e4567-e89b-12d3-a456-426614174000",\
          "scheduled_transaction_id": "123e4567-e89b-12d3-a456-426614174000",\
          "amount": 1,\
          "memo": null,\
          "payee_id": null,\
          "payee_name": null,\
          "category_id": null,\
          "category_name": null,\
          "transfer_account_id": null,\
          "deleted": true\
        }\
      ]
    }
  }
}
```

JSONCopy

JSONCopy

The scheduled transaction was successfully deleted

Show sidebar

Search

- User

Close Group






  - Get user
    HTTP Method:  GET
- Plans

Open Group

- Accounts

Open Group

- Categories

Open Group

- Payees

Open Group

- Payee Locations

Open Group

- Months

Open Group

- Money Movements

Open Group

- Transactions

Open Group

- Scheduled Transactions

Open Group


GET

Server: https://api.ynab.com/v1

/user

Copy URL

Send Send get request to https://api.ynab.com/v1/user

Close Client

Get user

AllAuthCookiesHeadersQuery

All

## AuthenticationRequired

Selected Auth Type: bearer

|     |
| --- |
| Bearer Token : <br>Show Password |

## Variables

| Enabled | Key | Value |
| --- | --- | --- |

## Cookies

| Enabled | Key | Value |
| --- | --- | --- |
|  | Key | Value |

## Headers

| Enabled | Key | Value |
| --- | --- | --- |
|  | Accept | \*/\* |
|  | Key | Value |

## Query Parameters

| Enabled | Key | Value |
| --- | --- | --- |
|  | Key | Value |

## Request Body

No Body

| None |
| --- |

## Code Snippet (Collapsed)

Shell Curl

Response

AllCookiesHeadersBody

All

[Powered By Scalar.com](https://www.scalar.com/)

.,,uod8B8bou,,. ..,uod8BBBBBBBBBBBBBBBBRPFT?l!i:. \|\|\|\|\|\|\|\|\|\|\|\|\|\|!?TFPRBBBBBBBBBBBBBBB8m=, \|\|\|\| '""^^!!\|\|\|\|\|\|\|\|\|\|TFPRBBBVT!:...! \|\|\|\| '""^^!!\|\|\|\|\|?!:.......! \|\|\|\| \|\|\|\|.........! \|\|\|\| \|\|\|\|.........! \|\|\|\| \|\|\|\|.........! \|\|\|\| \|\|\|\|.........! \|\|\|\| \|\|\|\|.........! \|\|\|\| \|\|\|\|.........! \|\|\|\|, \|\|\|\|.........\` \|\|\|\|\|!!-.\_ \|\|\|\|.......;. ':!\|\|\|\|\|\|\|\|\|!!-.\_ \|\|\|\|.....bBBBBWdou,. bBBBBB86foi!\|\|\|\|\|\|\|!!-..:\|\|\|!..bBBBBBBBBBBBBBBY! ::!?TFPRBBBBBB86foi!\|\|\|\|\|\|\|\|!!bBBBBBBBBBBBBBBY..! :::::::::!?TFPRBBBBBB86ftiaabBBBBBBBBBBBBBBY....! :::;\`"^!:;::::::!?TFPRBBBBBBBBBBBBBBBBBBBY......! ;::::::...''^::::::::::!?TFPRBBBBBBBBBBY........! .ob86foi;::::::::::::::::::::::::!?TFPRBY..........\` .b888888888886foi;:::::::::::::::::::::::..........\` .b888888888888888888886foi;::::::::::::::::...........b888888888888888888888888888886foi;:::::::::......\`!Tf998888888888888888888888888888888886foi;:::....\` '"^!\|Tf9988888888888888888888888888888888!::..\` '"^!\|Tf998888888888888888888888889!! '\` '"^!\|Tf9988888888888888888!!\` iBBbo. '"^!\|Tf998888888889!\` WBBBBbo. '"^!\|Tf9989!\` YBBBP^' '"^!\` \`

Send Request

ctrlControl

↵Enter