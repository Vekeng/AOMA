const commands = [
{
    type: 1, 
    name: 'add',
    description: 'Add new alert', 
    options: [{
        name: 'item', 
        type: 3,
        description: 'Item you want to monitor', 
        required: true,
        autocomplete: true
    },
    {
        name: 'quality', 
        type: 3,
        description: 'Do you want to trigger alert when price go higher than or lower than', 
        required: true,
        "choices": [
        {
          "name": "Normal",
          "value": "1"
        },
        {
          "name": "Good",
          "value": "2"
        },
        {
          "name": "Outstanding",
          "value": "3"
        },
        {
          "name": "Excellent",
          "value": "4"
        },
        {
          "name": "Masterpiece",
          "value": "5"
        }]
    },
    {
        name: 'threshold', 
        type: 3,
        description: 'Price at which bot should notify', 
        required: true,
    }, 
    {
        name: 'direction', 
        type: 3,
        description: 'Do you want to trigger alert when price go higher than or lower than', 
        required: true,
        "choices": [
        {
          "name": "Higher",
          "value": "higher"
        },
        {
          "name": "Lower",
          "value": "lower"
        }]
    }]
},
{
    name: 'delete',
    type: 1, 
    description: "Delete existing alert", 
    autocomplete: true,
    options: [{
        name: 'item', 
        type: 3, 
        description: 'Item to remove alert for', 
        autocomplete: true
    }]
},
{
    name: 'list', 
    type: 1, 
    description: "List your alerts",
}]

export {commands}; 