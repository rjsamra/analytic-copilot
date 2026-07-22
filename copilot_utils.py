# Agent class
### responsbility definition: expertise, scope, conversation script, style 
import sys  
from io import StringIO  
import contextlib  
from pathlib import Path  
import json
import os 
import base64
import traceback
from openai import OpenAI
from sqlalchemy import create_engine  
from plotly.graph_objects import Figure as PlotlyFigure
from matplotlib.figure import Figure as MatplotFigure
import matplotlib.pyplot as plt

def _streamlit():
    import streamlit as st
    return st

from plotly.io import write_image, to_json as plotly_to_json
from runtime import get_runtime, set_runtime, RuntimeContext
from visualization_utils import chart_display_payload, table_display_payload
from guardrails import (
    any_blocked,
    apply_row_cap,
    evaluate_sql,
    prompt_addons,
)

import shutil
import uuid
from tenacity import retry, wait_random_exponential, stop_after_attempt  
import pandas as pd
from dotenv import load_dotenv
import inspect
env_path = Path('.') / 'secrets.env'
load_dotenv(dotenv_path=env_path)
MAX_ERROR_RUN = 3
MAX_RUN_PER_QUESTION =10
MAX_QUESTION_TO_KEEP = 3
MAX_QUESTION_WITH_DETAIL_HIST = 1

emb_engine = os.getenv("OPENAI_EMB_DEPLOYMENT","text-embedding-ada-002")
chat_engine1 =os.getenv("OPENAI_GPT4_DEPLOYMENT","gpt-4o")
chat_engine2 =os.getenv("OPENAI_GPT35_DEPLOYMENT","gpt-4o")
sqllite_db_path= os.environ.get("SQLITE_DB_PATH","data/northwind.db")
engine = create_engine(f'sqlite:///{sqllite_db_path}') 

client = OpenAI(
    api_key = os.environ.get("OPENAI_API_KEY"),
)
max_conversation_len = 5  # Set the desired value of k

def get_embedding(text, model=emb_engine):
   text = text.replace("\n", " ")
   return client.embeddings.create(input = [text], model=model).data[0].embedding


def comment_on_graph(question, image_path="plot.jpg"):
    def encode_image(image_path):
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')

    # Path to your image

    # Getting the base64 string
    base64_image = encode_image(image_path)

    response = client.chat.completions.create(
    model=os.environ.get("OPENAI_VISION_DEPLOYMENT"),
    messages=[
        {
        "role": "user",
        "content": [
            {"type": "text", "text": question},
            {
            "type": "image_url",
            "image_url": {
                "url":  f"data:image/jpeg;base64,{base64_image}",
            },
            },
        ],
        }
    ],
    max_tokens=500,
    )

    return response.choices[0].message.content

def execute_sql_query(sql_query, limit=100):  
    result = pd.read_sql_query(sql_query, engine)
    result = result.infer_objects()
    for col in result.columns:  
        if 'date' in col.lower():  
            result[col] = pd.to_datetime(result[col], errors="ignore")  

    # result = result.head(limit)  # limit to save memory  
    # st.write(result)
    return result

def _llm_pick_scenarios(business_concepts: str, data: dict) -> list[str]:
    """Fallback: ask the LLM which analytic scenarios apply."""
    analytic_scenarios = data.get("analytic_scenarios", {})
    scenario_list_md = "| Scenario | Description |\n| --- | --- |\n"
    for name, info in analytic_scenarios.items():
        scenario_list_md += f"| {name} | {info.get('description', '')} |\n"

    sys_msg = f"""
    You are an AI assistant that helps people find information.
    You are given business concept(s) and you need to identify which one or several business analytic scenario(s) below are relevant to them.
    <<analytic_scenarios>>
    {scenario_list_md}
    <</analytic_scenarios>>
    Output your response in json format with the following structure:
    {{
        "scenarios": [
            {{
                "scenario_name": "..."
            }}
        ]
    }}
    """
    response = client.chat.completions.create(
        model=chat_engine1,
        messages=[
            {"role": "system", "content": sys_msg},
            {"role": "user", "content": business_concepts},
        ],
        response_format={"type": "json_object"},
    )
    response_message = response.choices[0].message.content.strip()
    scenario_names = [s["scenario_name"] for s in json.loads(response_message)["scenarios"]]
    valid = set(analytic_scenarios.keys())
    return [n for n in scenario_names if n in valid]


@retry(wait=wait_random_exponential(min=1, max=20), stop=stop_after_attempt(6))
def retrieve_context(business_concepts):
    with open(os.getenv("META_DATA_FILE", "data/metadata.json"), "r") as file:
        data = json.load(file)

    runtime = get_runtime()
    on_event = getattr(runtime, "on_event", None)
    resolved = getattr(runtime, "resolved_metric", None)
    allowed_tables = None
    if resolved and getattr(resolved, "tables", None):
        allowed_tables = resolved.tables
    elif resolved and isinstance(resolved, dict):
        allowed_tables = resolved.get("tables")

    analytic_scenarios = data.get("analytic_scenarios", {})
    scenario_tables_map = data.get("scenario_tables", {})
    all_tables = data.get("tables", {})
    all_relationships_raw = data.get("table_relationships", [])
    all_relationships = {
        (relationship[0], relationship[1]): relationship[2]
        for relationship in all_relationships_raw
        if len(relationship) >= 3
    }

    scenario_hits: list[dict] = []
    table_hits: list[dict] = []
    faiss_context = ""
    scenario_names: list[str] = []

    try:
        from schema_catalog import get_schema_catalog

        catalog = get_schema_catalog()
        if catalog.ready:
            scenario_hits = catalog.search(
                business_concepts,
                get_embedding,
                top_k=3,
                type_filter="scenario",
            )
            scenario_names = [
                h.get("scenario") for h in scenario_hits if h.get("scenario") in analytic_scenarios
            ]

            schema_hits = catalog.search(
                business_concepts,
                get_embedding,
                allowed_tables=allowed_tables,
                top_k=5,
                type_filter=["table", "relationship"],
            )
            table_hits = schema_hits
            if table_hits:
                label = (
                    "Schema catalog matches (scoped to resolved metric):\n"
                    if allowed_tables
                    else "Schema catalog matches:\n"
                )
                faiss_context = label
                for h in table_hits:
                    faiss_context += f"- {h.get('text', '')} (score={h.get('score', 0):.3f})\n"
                faiss_context += "\n"
    except Exception:
        scenario_hits = []
        table_hits = []

    if not scenario_names:
        scenario_names = _llm_pick_scenarios(business_concepts, data)
        scenario_hits = [{"scenario": n, "score": None, "type": "scenario"} for n in scenario_names]

    if allowed_tables:
        allowed_norm = {
            t.lower().replace("[", "").replace("]", "").replace(" ", "") for t in allowed_tables
        }
        kept_names: list[str] = []
        kept_hits: list[dict] = []
        hit_by_name = {h.get("scenario"): h for h in scenario_hits if h.get("scenario")}
        for sn in scenario_names:
            stabs = scenario_tables_map.get(sn, [])
            if any(
                t.lower().replace("[", "").replace("]", "").replace(" ", "") in allowed_norm
                for t in stabs
            ):
                kept_names.append(sn)
                kept_hits.append(hit_by_name.get(sn) or {"scenario": sn, "score": None, "type": "scenario"})
        if kept_names:
            scenario_names = kept_names
            scenario_hits = kept_hits

    if on_event:
        hit_by_name = {h.get("scenario"): h for h in scenario_hits if h.get("scenario")}
        on_event(
            "context_retrieval",
            {
                "scenarios": [
                    {
                        "name": sn,
                        "score": (hit_by_name.get(sn) or {}).get("score"),
                    }
                    for sn in scenario_names
                ],
                "tables": [
                    {
                        "table": h.get("table") or h.get("related") or "",
                        "type": h.get("type"),
                        "score": h.get("score"),
                        "text": h.get("text", ""),
                    }
                    for h in table_hits
                ],
            },
        )

    scenario_context = "Following tables might be relevant to the question: \n"
    tables: set[str] = set()
    for scenario_name in scenario_names:
        tables.update(scenario_tables_map.get(scenario_name, []))
    for table in tables:
        info = all_tables.get(table, {})
        scenario_context += (
            f"- table_name: {table} - description: {info.get('description', '')} "
            f"- columns: {info.get('columns', [])}\n"
        )

    scenario_context += "\n\nTable relationships: \n"
    for table1 in tables:
        for table2 in tables:
            if table1 == table2:
                continue
            relationship = all_relationships.get((table1, table2))
            if relationship:
                scenario_context += f"- {table1}, {table2}:{relationship}\n"

    scenario_context += "\nFollowing rules might be relevant: \n"
    for scenario_name in scenario_names:
        if scenario_name in analytic_scenarios:
            scenario_context += f"- {scenario_name}: {str(analytic_scenarios[scenario_name]['rules'])}\n"

    if faiss_context:
        scenario_context = faiss_context + scenario_context
    return scenario_context

today = pd.Timestamp.today()
#format today's date
today = today.strftime("%Y-%m-%d")
CODER1 = f"""
You are a highly skilled data analyst proficient in data analysis, visualization, SQL, and Python, tasked with responding to inquiries from business users. 
Today's date is {today}. The data is housed in a SQLITE database. All data queries, transformations, and visualizations must be conducted through a designated Python interface.
Your initial step is to engage with the user to grasp their requirements, asking clarifying questions as necessary. Next, you will review the relevant business rules and table schemas that pertain to the user's query to adeptly craft your code for answering their questions.
If the query is intricate, employ best practices in business analytics to decompose it into manageable steps, articulating your analytical process to the user throughout. Conclude by presenting your findings in a clear, succinct manner, employing visualizations when beneficial to optimally convey your insights.

"""
CODER2= f"""
You are a highly skilled data analyst proficient in data analysis, visualization, SQL, and Python, tasked with addressing inquiries from business users. Today's date is {today}. 
The data is stored in an SQLITE database, and all data querying, transformation, and visualization must be conducted through a Python interface provided to you.
Begin by engaging with the user to fully understand their requirements, asking clarifying questions as needed. You are provided with similiar answered questions with solutions.
First, assess whether these reference solutions offer sufficient context to address the new user question. If they do, proceed to implement the solution directly. 
If they do not provide enough information, utilize the 'retrieve additional context' function to gather more details necessary to formulate an accurate response.

When presenting results, always choose the visualization that best answers the question:
- Use a line chart for trends over time (dates, years, months).
- Use a bar chart to compare categories (top customers, products, countries).
- Use a pie chart only for small part-to-whole breakdowns (roughly 8 or fewer slices).
- Use a scatter plot when comparing two numeric measures.
- Use a table when the user needs exact values, many columns, or a single scalar result.

Prefer `show_to_user(plotly_figure)` for analytical answers. You may also call `show_to_user(dataframe)` when a table is the primary answer; a chart will be added automatically when appropriate.
Only use plotly (plotly.express or plotly.graph_objects) for charts. Call show_to_user once with the best primary view for the question.
"""


def create_or_update_action_plan(new_or_updated_plan):
    return new_or_updated_plan
def update_notebook(existing_content, new_content):  
    """  
    Update the existing notebook content with new content.  
  
    :param existing_content: The existing content of the notebook.  
    :param new_content: The new content to add to the notebook.  
    :return: The updated notebook content.  
    """  
    # Identify the start of the notebook section  
    notebook_start = existing_content.find('## Notebook:')  
      
    # Check if the notebook section is found  
    if notebook_start == -1:  
        # The notebook section doesn't exist, return the original content  
        return existing_content  
      
    # Extract the content before and after the notebook section  
    before_notebook = existing_content[:notebook_start]  
      
    updated_content = before_notebook.strip() +"\n## Action plan:\n"+ new_content.strip()    
      
    return updated_content  



def execute_python_code(assumptions, goal,python_code,execution_context):

    def execute_sql_query(sql_query, limit=100):
        runtime = get_runtime()
        attached = getattr(runtime, "attached_guardrails", None) or []
        on_event = getattr(runtime, "on_event", None)
        if attached:
            sql_checks = evaluate_sql(sql_query, attached, on_event=on_event)
            if any_blocked(sql_checks):
                blocked = next(c for c in sql_checks if c.status == "blocked")
                raise ValueError(f"Guardrail blocked SQL ({blocked.name}): {blocked.detail}")

        result = pd.read_sql_query(sql_query, engine)
        result = result.infer_objects()
        for col in result.columns:
            if 'date' in col.lower():
                result[col] = pd.to_datetime(result[col], errors="ignore")

        if attached:
            result, _ = apply_row_cap(result, attached, on_event=on_event)
        elif limit:
            result = result.head(limit)
        return result
  
    def reduce_dataframe_size(df):  
        max_str_length = 100  
        max_list_length = 3
        
        reduced_df = pd.DataFrame()  
        
        for column in df.columns:  
            if df[column].dtype == object or df[column].dtype == str:  
                reduced_df[column] = df[column].apply(lambda x: reduce_cell(x, max_str_length, max_list_length))  
            else:  
                reduced_df[column] = df[column]  
        
        return reduced_df  
  
    def reduce_cell(cell, max_str_length, max_list_length):  
        try:  
            data = json.loads(cell)  
            if isinstance(data, list):  
                data = truncate_list(data, max_list_length)  
            return json.dumps(data)  
        except (json.JSONDecodeError, TypeError):  
            return str(cell)[:max_str_length]  
    
    def truncate_list(lst, max_list_length):  
        truncated = lst[:max_list_length]  
        for i, item in enumerate(truncated):  
            if isinstance(item, dict):  
                truncated[i] = truncate_dict(item, max_list_length)  
            elif isinstance(item, list):  
                truncated[i] = truncate_list(item, max_list_length)  
        return truncated  
    
    def truncate_dict(dct, max_list_length):  
        for key, value in dct.items():  
            if isinstance(value, list):  
                dct[key] = truncate_list(value, max_list_length)  
            elif isinstance(value, dict):  
                dct[key] = truncate_dict(value, max_list_length)  
        return dct  
    
    def show_to_user(data):
        runtime = get_runtime()
        runtime['data'] = data
        question = "Describe this graph in detail"
        for session_item in list(runtime.keys()):
            if 'data_from_display' in session_item or 'comment_on_graph' in session_item:
                del runtime[session_item]
        img_folder =  str(uuid.uuid4())
        os.makedirs(img_folder, exist_ok=True)
        image_path=os.path.join(img_folder,"plot.jpg")
        show_thoughts = getattr(runtime, "show_internal_thoughts", False)
        use_gpt4v = getattr(runtime, "use_gpt4v", False)
        on_display = getattr(runtime, "on_display", None) if isinstance(runtime, RuntimeContext) else None

        if show_thoughts:
            _streamlit().write("Goal: "+goal)
            _streamlit().write("Assumptions: \n"+assumptions)

        try:
            if type(data) is PlotlyFigure:
                if on_display:
                    on_display({
                        "type": "chart",
                        "format": "plotly",
                        "data": plotly_to_json(data),
                        "chartKind": "custom",
                        "autoGenerated": False,
                    })
                else:
                    _streamlit().plotly_chart(data)
                comment ="The graph for the data is shown to the user."
                if use_gpt4v:
                    write_image(data, image_path)
                    comment = comment_on_graph(question, image_path)
                    comment = "the graph is displayed and this is the description of the graph: \n" + comment + "\n"
                runtime['comment_on_graph'] = comment

            elif type(data) is MatplotFigure:
                if on_display:
                    plt.savefig(image_path)
                    with open(image_path, "rb") as image_file:
                        image_b64 = base64.b64encode(image_file.read()).decode("utf-8")
                    on_display({"type": "chart", "format": "matplotlib", "data": image_b64})
                else:
                    _streamlit().pyplot(data)
                    plt.savefig(image_path)
                comment = comment_on_graph(question, image_path)
                runtime['comment_on_graph'] = comment

            elif type(data) is pd.DataFrame:
                data = data.head(30)
                data = reduce_dataframe_size(data)
                table_payload = table_display_payload(data)
                if on_display:
                    on_display(table_payload)
                    chart_payload = chart_display_payload(data)
                    if chart_payload:
                        on_display(chart_payload)
                else:
                    _streamlit().dataframe(data)
                runtime['data_from_display_'+str(uuid.uuid4())] = data.to_markdown(index=False, disable_numparse=True)
            else:
                if on_display:
                    on_display({"type": "text", "data": str(data)})
                else:
                    _streamlit().write(data)
                runtime['data_from_display'] = str(data)
        except Exception as e:
            print("Error in generating commment on the graph: ", e)
        finally:
            shutil.rmtree(img_folder)
    if 'execute_sql_query' not in execution_context:
        execution_context['execute_sql_query'] = execute_sql_query 
    if 'show_to_user' not in execution_context: 
        execution_context['show_to_user'] = show_to_user  

    # Define a context manager to redirect stdout and stderr  
    @contextlib.contextmanager  
    def captured_output():  
        new_out, new_err = StringIO(), StringIO()  
        old_out, old_err = sys.stdout, sys.stderr  
        try:  
            sys.stdout, sys.stderr = new_out, new_err  
            yield sys.stdout, sys.stderr  
        finally:  
            sys.stdout, sys.stderr = old_out, old_err  
  
    # Use the context manager to capture output  
    with captured_output() as (out, err):  
        try:  
            exec(python_code, execution_context)
            
        except Exception as e:  
            if hasattr(e, 'message'):
                print("with message in exception")
                print(f"{type(e)}: {e.message}", file=sys.stderr)  
            else:
                print(f"{type(e)}: {e}", file=sys.stderr)  

    
    # Retrieve the captured output and errors  
    stdout = out.getvalue()  
    stderr = err.getvalue()  

    new_input=""
    if len(stdout)>0:
        new_input +="\n"+ stdout 
        print(new_input)        
        return execution_context, new_input

    if len(stderr)>0:
        new_input +="\n"+stderr
        print(new_input)
        print(python_code)
        return execution_context, new_input
    runtime = get_runtime()
    data_display=""
    for session_item in runtime.keys():
        if 'data_from_display' in session_item:
            data_display +="\n" + runtime[session_item]
    if len(data_display)>0:
        return execution_context, data_display
    if 'comment_on_graph' in runtime:
        return execution_context, str(runtime['comment_on_graph'])
    else:
        return execution_context, "The graph for the data is displayed to the user."
    



def resolve_entities(business_question):
    if 'VINET' in business_question:
        return business_question.replace("VINET", "VINET customer")
    return "Cannot resolve the entities in the question. Please clarify with the customer."
def get_additional_context():
    pass

CODER_AVAILABLE_FUNCTIONS1 = {
            "execute_python_code": execute_python_code,
            "retrieve_context": retrieve_context,
        } 


CODER_FUNCTIONS_SPEC1= [  
    
    {
        "type":"function",
        "function":{

        "name": "execute_python_code",
        "description": "A special python interface that can run data analytical python code against the SQL database and data visualization with plotly. Do not use from pandas.io.json import json_normalize use from pandas import json_normalize instead",
        "parameters": {
            "type": "object",
            "properties": {
                "assumptions": {
                    "type": "string",
                    "description": "List of assumptions you made in your code."
                },
                "goal": {
                    "type": "string",
                    "description": "description of what you hope to achieve with this python code snippset. The description should be in the same language as the question asked by the user."
                },

                "python_code": {
                    "type": "string",
                    "description": "Complete executable python code. You are provided with following utility python functions to use INSIDE your code \n 1. execute_sql_query(sql_query: str) a function to execute SQL query against the SQLITE database to retrieve data you need. This execute_sql_query(sql_query: str) function returns a pandas dataframe that you can use to perform any data analysis and visualization. Be efficient, avoid using Select *, instead select specific column names if possible\n 2. show_to_user(data): a util function to display the data analysis and visualization result from this environment to user. This function can take a pandas dataframe or plotly figure as input. For example, to visualize a plotly figure, the code can be ```fig=px.bar(some_df, x='country', y='total_sales')\n show_to_user(fig)```. Only use plotly for graph visualization. Pick the chart type that best fits the question: line for time trends, bar for category comparisons, pie for small part-to-whole splits, scatter for two numeric measures, table (dataframe) for exact values. Remember, only use show_to_user if you want to display the data to the user. If you want to observe any data for yourself, use print() function instead "
                },


            },
            "required": ["assumptions", "goal","python_code" ],
        },

    }
    },
    {
        "type":"function",
        "function":{

        "name": "retrieve_context",
        "description": "retrieve business rules and table schemas that are relevant to the customer's question",

        "parameters": {
            "type": "object",
            "properties": {
                "business_concepts": {
                    "type": "string",
                    "description": "One or multiple business concepts that the user is asking about. For example, 'total sales', 'top customers', 'most popular products'." 
                }


            },
            "required": ["business_concepts"],
        },
    }
    },


]  

CODER_FUNCTIONS_SPEC2= [{
        "type":"function",
        "function":{

        "name": "get_additional_context",
        "description": "Current context information is not sufficient, get additional context to be able to write code to answer the question",
        },

    }]
CODER_FUNCTIONS_SPEC2.append(CODER_FUNCTIONS_SPEC1[0]) #append execute_python_code to CODER_FUNCTIONS_SPEC2
#

CODER_AVAILABLE_FUNCTIONS2={}
CODER_AVAILABLE_FUNCTIONS2["execute_python_code"] = execute_python_code
CODER_AVAILABLE_FUNCTIONS2["get_additional_context"] = get_additional_context


def message_to_dict(message):
    if isinstance(message, dict):
        return message
    if hasattr(message, "model_dump"):
        return message.model_dump(exclude_none=True)
    if hasattr(message, "dict"):
        return message.dict(exclude_none=True)
    return message


def sanitize_conversation(history):
    """Remove assistant tool-call turns that do not have matching tool responses."""
    sanitized = [message_to_dict(message) for message in history]
    changed = True
    while changed:
        changed = False
        idx = 0
        while idx < len(sanitized):
            message = sanitized[idx]
            if message.get("role") != "assistant" or not message.get("tool_calls"):
                idx += 1
                continue

            required_ids = {
                tool_call.get("id")
                for tool_call in message.get("tool_calls", [])
                if tool_call.get("id")
            }
            answered_ids = set()
            end_idx = idx + 1
            while end_idx < len(sanitized) and sanitized[end_idx].get("role") == "tool":
                tool_call_id = sanitized[end_idx].get("tool_call_id")
                if tool_call_id:
                    answered_ids.add(tool_call_id)
                end_idx += 1

            if required_ids and required_ids.issubset(answered_ids):
                idx = end_idx
                continue

            del sanitized[idx:end_idx]
            changed = True

    return sanitized


def prepare_messages_for_api(history):
    prepared = []
    for message in sanitize_conversation(history):
        msg = message_to_dict(message)
        clean = {"role": msg["role"]}
        if msg.get("content") is not None:
            clean["content"] = msg["content"]
        if msg.get("name"):
            clean["name"] = msg["name"]
        if msg.get("tool_calls"):
            clean["tool_calls"] = msg["tool_calls"]
        if msg.get("tool_call_id"):
            clean["tool_call_id"] = msg["tool_call_id"]
        prepared.append(clean)

    # Soft guardrails + semantic layer: append to system message on every API call.
    runtime = get_runtime()
    addon = getattr(runtime, "guardrail_prompt_addon", "") or ""
    semantic_addon = getattr(runtime, "semantic_prompt_addon", "") or ""
    combined = addon
    if semantic_addon:
        combined = (combined + "\n\n" + semantic_addon) if combined else semantic_addon
    if combined and prepared and prepared[0].get("role") == "system":
        base = prepared[0].get("content") or ""
        if "## Active Guardrails" not in base and "## Semantic Layer Context" not in base:
            prepared[0] = {**prepared[0], "content": base + combined}
        elif "## Semantic Layer Context" not in base and semantic_addon:
            prepared[0] = {**prepared[0], "content": base + "\n\n" + semantic_addon}
    return prepared


def check_args(function, args):
    sig = inspect.signature(function)
    params = sig.parameters

    # Check if there are extra arguments
    for name in args:
        if name not in params:
            return False
    # Check if the required arguments are provided 
    for name, param in params.items():
        if param.default is param.empty and name not in args:
            return False
def clean_up_history(history, max_q_with_detail_hist=1, max_q_to_keep=2):
    # start from end of history, count the messages with role user, if the count is more than max_q_with_detail_hist, remove messages from there with roles tool.
    # if the count is more than max_q_hist_to_keep, remove all messages from there until message number 1
    question_count=0
    removal_indices=[]
    for idx in range(len(history)-1, 0, -1):
        message = message_to_dict(history[idx])
        if message.get("role") == "user":
            question_count +=1
            # print("question_count added, it becomes: ", question_count)   
        if question_count>= max_q_with_detail_hist and question_count < max_q_to_keep:
            if message.get("role") != "user" and message.get("role") != "assistant" and len(message.get("content")) == 0:
                removal_indices.append(idx)
        if question_count >= max_q_to_keep:
            removal_indices.append(idx)
    
    # remove items with indices in removal_indices
    for index in removal_indices:
        del history[index]

def reset_history_to_last_question(history):
    #pop messages from history from last item to the message with role user
    for i in range(len(history)-1, -1, -1):
        message = message_to_dict(history[i])   
        if message.get("role") == "user":
            break
        history.pop()
    runtime = get_runtime()
    for session_item in list(runtime.keys()):
        if 'data_from_display' in session_item or 'comment_on_graph' in session_item:
            del runtime[session_item]


class Smart_Agent():
    """
    """

    def __init__(self, persona,functions_spec, functions_list, name=None, init_message=None, engine =chat_engine2, on_event=None):
        if init_message is not None:
            init_hist =[{"role":"system", "content":persona}, {"role":"assistant", "content":init_message}]
        else:
            init_hist =[{"role":"system", "content":persona}]

        self.init_conversation = [message.copy() for message in init_hist]
        self.init_message = init_message
        self.init_persona = "coder2" if functions_spec == CODER_FUNCTIONS_SPEC2 else "coder1"
        self.init_functions_spec = functions_spec
        self.init_functions_list = functions_list
        self.init_engine = engine
        self.conversation = [message.copy() for message in init_hist]
        self.persona = self.init_persona
        self.engine = engine
        self.name= name
        self.on_event = on_event

        self.functions_spec = functions_spec
        self.functions_list= functions_list

    def reset_conversation(self):
        self.conversation = [message.copy() for message in self.init_conversation]
        self.persona = self.init_persona
        self.engine = self.init_engine
        self.functions_spec = self.init_functions_spec
        self.functions_list = self.init_functions_list

    def _emit(self, event_type, payload=None):
        if self.on_event:
            self.on_event(event_type, payload or {})
    def switch_persona(self, similiar_question=None):
            
            if self.persona == "coder1" or similiar_question is not None:
                if similiar_question is not None:
                    new_system_message = {"role": "system", "content": CODER2+"here are similiar answered questions with solutions: \n"+similiar_question}
                    self.conversation[0]= new_system_message
                    self.engine = chat_engine2
                    self.persona = "coder2"
                    self.functions_spec = CODER_FUNCTIONS_SPEC2
                    self.functions_list = CODER_AVAILABLE_FUNCTIONS2
                    if self.engine == chat_engine2:
                        print("Giving similiar solutions context to coder2")
                    else:
                        print("Switching persona to coder2 from coder1")
            elif self.persona == "coder2":
                print("Switching persona to coder1")
                new_system_message = {"role": "system", "content": CODER1}
                self.conversation[0]= new_system_message
                self.engine = chat_engine1
                self.persona = "coder1"
                self.functions_spec = CODER_FUNCTIONS_SPEC1
                self.functions_list = CODER_AVAILABLE_FUNCTIONS1


    # @retry(wait=wait_random_exponential(min=1, max=20), stop=stop_after_attempt(6))
    def run(self, user_input, conversation=None, stream = False, ):
        if user_input is None: #if no input return init message
            self.reset_conversation()
            return self.conversation, self.init_message or self.conversation[-1]["content"]
        if conversation is not None: #if no history return init message
            self.conversation = sanitize_conversation(conversation)

        self._emit("step_start", {"step": "understand", "label": "Understanding your question", "detail": user_input})
        # similiar_question = get_cache(user_input)
        similiar_question = []
        if self.persona == "coder1":
            if len(similiar_question)>0:
                self.switch_persona(similiar_question)
        else:
            if len(similiar_question)>0:
                self.switch_persona(similiar_question) #updating coder 2 with similiar questions
            else:
                self.switch_persona() #no similiar questions, switch to coder 1

        self._emit("step_complete", {"step": "understand"})
        self._emit("step_start", {
            "step": "plan",
            "label": "Planning analysis approach",
            "detail": f"Using {self.persona} persona with {self.engine}",
        })
        self.conversation.append({"role": "user", "content": user_input, "name": "James"})
        clean_up_history(self.conversation, max_q_with_detail_hist=MAX_QUESTION_WITH_DETAIL_HIST, max_q_to_keep=MAX_QUESTION_TO_KEEP)
            
        execution_error_count=0
        code = ""
        response_message = None
        data ={}
        execution_context={}
        run_count =0
        while True:
            if run_count >= MAX_RUN_PER_QUESTION:
                reset_history_to_last_question(self.conversation)
                print(f"Need to move on from this question due to max run count reached ({run_count} runs)")
                response_message= {"role": "assistant", "content": "I am unable to answer this question at the moment, please ask another question."}
                break
            if execution_error_count >= MAX_ERROR_RUN:
                reset_history_to_last_question(self.conversation)
                print(f"resetting history due to too many errors ({execution_error_count} errors) in the code execution")
                execution_error_count=0
            response = client.chat.completions.create(
                model=self.engine, # The deployment name you chose when you deployed the GPT-35-turbo or GPT-4 model.
                messages=prepare_messages_for_api(self.conversation),
            tools=self.functions_spec,
            tool_choice='auto',
              temperature=0.2,

            
            )
            run_count+=1
            response_message = response.choices[0].message
            if response_message.content is None:
                response_message.content = ""
            tool_calls = response_message.tool_calls
            

            # print("assistant response: ", response_message.content)
            # Step 2: check if GPT wanted to call a function
            if  tool_calls:
                # print("Tool calls: ")
                self.conversation.append(message_to_dict(response_message))  # extend conversation with assistant's reply
                needs_additional_context = False
                for tool_call in tool_calls:
                    function_name = tool_call.function.name

                    print("Recommended Function call:")
                    print(function_name)
                    print()
                    if function_name == "get_additional_context":
                        self._emit("step_start", {"step": "context", "label": "Retrieving business context", "detail": "Matching scenarios, tables, and rules"})
                        self.switch_persona()
                        reset_history_to_last_question(self.conversation)
                        run_count=0
                        needs_additional_context = True
                        break

                    # Step 3: call the function
                    # Note: the JSON response may not always be valid; be sure to handle errors
                                    
                    # verify function exists
                    if function_name not in self.functions_list:
                        # raise Exception("Function " + function_name + " does not exist")
                        print(("Function " + function_name + " does not exist, retrying"))
                        self.conversation.pop()
                        break
                    function_to_call = self.functions_list[function_name]
                    
                    # verify function has correct number of arguments
                    try:
                        function_args = json.loads(tool_call.function.arguments)
                    except json.JSONDecodeError as e:
                        print(e)
                        self.conversation.pop()
                        break
                    if function_name == "execute_python_code":
                        function_args["execution_context"] = execution_context

                    if check_args(function_to_call, function_args) is False:
                        self.conversation.pop()
                        break
                    if function_name == "execute_python_code":
                        self._emit("step_start", {
                            "step": "generate",
                            "label": "Generating SQL & Python",
                            "detail": function_args.get("goal", ""),
                            "code": function_args.get("python_code", ""),
                            "assumptions": function_args.get("assumptions", ""),
                        })
                        execution_context, function_response = function_to_call(**function_args)
                        runtime = get_runtime()
                        if "data" in runtime:
                            data[tool_call.id] = runtime['data']
                        if "error" in function_response:
                            execution_error_count+=1
                            self._emit("step_error", {"step": "execute", "detail": function_response[:500]})
                        else:
                            code = function_args["python_code"]
                            self._emit("step_complete", {"step": "generate", "code": code})
                            self._emit("step_start", {"step": "execute", "label": "Executing query & rendering results"})
                            self._emit("step_complete", {"step": "execute"})
                            self._emit("step_complete", {"step": "plan"})

                    else:
                        function_response = str(function_to_call(**function_args))
                        if function_name == "retrieve_context":
                            self._emit("step_complete", {"step": "context", "detail": function_response[:800]})
                                     
                    # print("Output of function call:")
                    # print("length of function_response", len(function_response))
                    print()
                    if function_name == "message_user" or function_name =="message_team": #special case when coder finished the code execution and ready to respond to user or the coder needs to clarify with context preparer
                        return function_response

                
                    self.conversation.append(
                        {
                            "tool_call_id": tool_call.id,
                            "role": "tool",
                            "name": function_name,
                            "content": function_response,
                        }
                    )  # extend conversation with function response
                    
                if needs_additional_context:
                    continue
                continue
            else:
                # print('no function call')
                break #if no function call break out of loop as this indicates that the agent finished the research and is ready to respond to the user

        if not stream:
            self.conversation.append(message_to_dict(response_message))
            if type(response_message) is dict:
                assistant_response = response_message.get('content')
            else:
                assistant_response = message_to_dict(response_message).get('content')
            self._emit("step_start", {"step": "respond", "label": "Composing final answer"})
            self._emit("step_complete", {"step": "respond", "answer": assistant_response})
            # conversation.append({"role": "assistant", "content": assistant_response})

        else:
            assistant_response = response_message
        print(code)
        return stream,code, self.conversation, assistant_response, data
    

import re

def extract_sql_query(text):
    """Extract SQL from triple-quoted strings in generated Python code."""
    if not text:
        return None
    pattern = r"(?:'''|\"\"\")(.*?)(?:'''|\"\"\")"
    for match in re.finditer(pattern, text, re.DOTALL):
        query = match.group(1).strip()
        if re.match(r"(?is)^(WITH|SELECT|INSERT|UPDATE|DELETE|CREATE)\b", query):
            return query
    match = re.search(pattern, text, re.DOTALL)
    if match:
        return match.group(1).strip() or None
    return None
